/**
 * Engager nurture engine.
 *
 * Post engagers (people who reacted to / commented on YOUR posts, stored in
 * warm_contacts) used to get a single connect draft. This runs them through the
 * SAME research -> comment -> connect -> DM sequence directory leads use, on the
 * SAME engagement_tasks queue + Signals safety envelope, but with an
 * agenda-aware angle so the sequence serves the user's actual goal (land an
 * internship, win customers, hire, raise) in their own voice.
 *
 * Stage machine (warm_contacts.nurture_stage, shared vocabulary with leads):
 *   discovered -> engaging (comment queued) -> connect_ready -> connect_sent
 *   -> dm_ready -> dm_sent
 * When no recent post exists we skip the comment and go straight to
 * connect_ready (connect directly), mirroring plan-lead.
 */
import type { createClient } from '@insforge/sdk';
import { draftOutboundComment } from '@/lib/engagement/tasks';
import { fetchLinkedInPostForIdentifier, type ProspectPost } from '@/lib/gtm/nurture/linkedin-posts';
import { connectDueAt } from '@/lib/gtm/nurture/playbook';
import { isLinkedInFirstDegree } from '@/lib/gtm/nurture/connection-check';
import { assertAutoSendAllowed, sleep } from '@/lib/signals/safety';
import { getSafetySettings } from '@/lib/signals/safety/settings';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { getActiveIcpProfile } from '@/lib/signals/leads/icp-profiles';
import { getWorkspaceOwnerUserId } from '@/lib/signals/ingest/workspace-account';
import { resolveAgenda, defaultAgenda, type Agenda } from '@/lib/signals/leads/agenda';
import { buildEngagerDossier, dossierInputFromContact } from '@/lib/social-graph/dossier';
import { sendWarmContactConnect, sendWarmContactDm } from '@/lib/social-graph/outreach';
import { getWarmContact } from '@/lib/social-graph/warm-contacts';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { withTimeout } from '@/lib/util/timeout';
import type { EngagerDossier, WarmContactRow } from '@/lib/social-graph/types';
import type { LeadPlaybook, NurtureStage } from '@/lib/signals/types';
import { logError, logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

/** Best-effort prospect-post lookup budget; misses fall through to connect-direct. */
const POST_FETCH_TIMEOUT_MS = 3500;
const MAX_PLAN_PER_RUN = 5;
const MAX_SEND_PER_RUN = 3;

// --- Priority scoring --------------------------------------------------------

/**
 * Rough priority for surfacing/ordering engagers: ICP fit dominates, a comment
 * beats a like (higher intent), and having a resolvable profile adds a nudge.
 * Bounded 0..1 so it sits alongside lead rank_score in the unified feed.
 */
export function scoreEngagerPriority(
  contact: Pick<WarmContactRow, 'category' | 'reaction_type' | 'public_identifier' | 'provider_profile_id'>,
): number {
  let score = 0.2;
  if (contact.category === 'ICP') score += 0.5;
  else if (contact.category === 'Potential Lead') score += 0.3;
  else if (contact.category === 'Community') score += 0.1;
  // Commenters carry a synthetic 'COMMENT' reaction_type in some syncs.
  if ((contact.reaction_type ?? '').toUpperCase().includes('COMMENT')) score += 0.15;
  if (contact.provider_profile_id || contact.public_identifier) score += 0.1;
  return Math.min(1, Math.round(score * 100) / 100);
}

// --- Playbook ----------------------------------------------------------------

/** Builds an agenda-aware engager playbook (same shape as lead playbooks). */
export function buildEngagerPlaybook(
  contact: Pick<WarmContactRow, 'display_name' | 'headline' | 'source_post_title'>,
  agenda: Agenda,
  dossier?: EngagerDossier | null,
): LeadPlaybook {
  const who = contact.display_name?.trim() || 'This engager';
  return {
    whyThem:
      dossier?.whyMatters ||
      `${who} engaged with "${contact.source_post_title ?? 'your post'}" - a warm entry point.`,
    angle: dossier?.angle || agenda.pitchAngle,
    steps: [
      { type: 'research', label: 'Review their profile + recent activity', dueInDays: 0, status: 'pending' },
      { type: 'comment', label: 'Leave a value-add comment on a recent post', dueInDays: 1, status: 'pending' },
      { type: 'connect', label: 'Send a connect note referencing the engagement', dueInDays: 2, status: 'pending' },
      { type: 'dm', label: 'After they accept, send a light follow-up DM', dueInDays: 7, status: 'pending' },
    ],
    hookContext: dossier?.summary,
    generatedAt: new Date().toISOString(),
  };
}

function markStep(pb: LeadPlaybook, type: LeadPlaybook['steps'][number]['type'], status: 'done' | 'skipped'): LeadPlaybook {
  return { ...pb, steps: pb.steps.map((s) => (s.type === type ? { ...s, status } : s)) };
}

// --- DB helpers --------------------------------------------------------------

async function updateWarmContact(
  client: InsforgeClient,
  userId: string,
  contactId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await client.database
    .from('warm_contacts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('user_id', userId);
}

function commentDueAt(from: Date = new Date()): Date {
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + 1);
  due.setUTCHours(14, 30, 0, 0);
  return due;
}

function dmDueAt(from: Date = new Date()): Date {
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + 5);
  due.setUTCHours(16, 0, 0, 0);
  return due;
}

// --- Drafting ----------------------------------------------------------------

function contactIdentifier(contact: WarmContactRow): string | null {
  return contact.public_identifier?.trim() || contact.profile_url?.trim() || null;
}

/** Drafts an agenda-aware connect note or DM for an engager, in the creator's voice. */
async function draftEngagerMessage(
  client: InsforgeClient,
  userId: string,
  workspaceId: string | null,
  contact: WarmContactRow,
  agenda: Agenda,
  dossier: EngagerDossier | null,
  channel: 'linkedin_connect' | 'linkedin_dm',
): Promise<string> {
  const voice = await loadCreatorVoiceContext(client, userId, {
    workspaceId: workspaceId ?? undefined,
    platform: 'linkedin',
    lightweight: true,
    includeGtm: true,
  });

  const isConnect = channel === 'linkedin_connect';
  const prompt = [
    isConnect
      ? 'Write a short LinkedIn connection note (max 280 chars).'
      : 'Write a short, warm LinkedIn DM follow-up (3-5 sentences) to a new 1st-degree connection.',
    `Goal / angle: ${agenda.pitchAngle}`,
    agenda.toneRules ? `Tone rules: ${agenda.toneRules}` : null,
    dossier?.angle ? `Suggested angle for this person: ${dossier.angle}` : null,
    contact.source_post_title
      ? `They engaged with your post: "${contact.source_post_title}".`
      : null,
    contact.headline ? `Their headline: ${contact.headline}` : null,
    contact.display_name ? `Name: ${contact.display_name}` : null,
    'Reference their engagement naturally. Sound human and peer-to-peer. Never salesy.',
    'No em dashes, no emojis, no hashtags, no "I came across your profile".',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await generateWithVoicePipeline({
    userPrompt: prompt,
    profile: voice.profile,
    contextAdditions: voice.contextAdditions,
    platform: 'linkedin',
    contentType: 'reply',
    fast: true,
  });

  const text = result.text.trim();
  return isConnect ? enforceConnectLimit(text) : text;
}

// --- Plan (research -> comment | connect-direct) -----------------------------

export interface PlanEngagerResult {
  contactId: string;
  nurtureStage: NurtureStage;
  path: 'comment' | 'connect-direct';
  commentTaskId?: string;
}

/**
 * Researches an engager and starts the sequence: dossier -> if a recent post
 * exists, queue a voice comment (stage 'engaging'); else draft a connect note
 * and go straight to 'connect_ready'.
 */
export async function planEngagerNurture(
  client: InsforgeClient,
  userId: string,
  workspaceId: string | null,
  contactId: string,
  agendaOverride?: Agenda,
): Promise<PlanEngagerResult> {
  const contact = await getWarmContact(client, userId, contactId);
  if (!contact) throw new Error('Engager not found.');
  if (contact.status === 'dismissed') throw new Error('Engager was dismissed.');

  let agenda: Agenda;
  if (agendaOverride) {
    agenda = agendaOverride;
  } else if (workspaceId) {
    const profile = await getActiveIcpProfile(client, workspaceId);
    agenda = profile ? resolveAgenda(profile) : defaultAgenda();
  } else {
    agenda = defaultAgenda();
  }

  const identifier = contactIdentifier(contact);

  // Research dossier (best-effort recent post improves the angle).
  let recentPost: ProspectPost | null = null;
  if (identifier && workspaceId) {
    recentPost = await withTimeout(
      fetchLinkedInPostForIdentifier(client, workspaceId, userId, identifier),
      POST_FETCH_TIMEOUT_MS,
      null,
    );
  }
  const dossier = await buildEngagerDossier(
    dossierInputFromContact(contact, recentPost?.excerpt),
    agenda,
  );
  const priority = scoreEngagerPriority(contact);
  let playbook = buildEngagerPlaybook(contact, agenda, dossier);

  const basePatch: Record<string, unknown> = {
    dossier: [dossier.summary, dossier.whyMatters, dossier.angle].filter(Boolean).join(' '),
    dossier_json: dossier,
    icp_profile_id: agenda.profileId,
    goal_type: agenda.goalType,
    priority_score: priority,
  };

  // Comment-first path when we found a recent post.
  if (recentPost) {
    const draft = await draftOutboundComment(client, userId, {
      targetPostExcerpt: recentPost.excerpt,
      targetAuthorName: contact.display_name ?? undefined,
      platform: 'linkedin',
      fast: true,
    });

    const settings = await getSafetySettings(client, workspaceId ?? '');
    const autoApprove = settings.auto_send_enabled && settings.outreach_enabled && !settings.dry_run;
    const scheduledAt = commentDueAt();

    const { data, error } = await client.database
      .from('engagement_tasks')
      .insert([
        {
          user_id: userId,
          workspace_id: workspaceId,
          warm_contact_id: contact.id,
          platform: 'linkedin',
          kind: 'comment',
          target_provider_post_id: recentPost.id,
          target_post_url: recentPost.url ?? null,
          target_author_name: contact.display_name ?? null,
          target_post_excerpt: recentPost.excerpt.slice(0, 2000),
          source: 'engager_nurture',
          comment_text: draft.text,
          status: autoApprove ? 'approved' : 'draft',
          scheduled_at: scheduledAt.toISOString(),
        },
      ])
      .select('id')
      .single();
    if (error || !data?.id) throw new Error(error?.message ?? 'Could not queue engager comment task.');

    playbook = {
      ...markStep(playbook, 'research', 'done'),
      targetPost: {
        id: recentPost.id,
        excerpt: recentPost.excerpt.slice(0, 500),
        url: recentPost.url,
        source: recentPost.source,
      },
      commentTaskId: data.id as string,
    };

    await updateWarmContact(client, userId, contactId, {
      ...basePatch,
      nurture_stage: 'engaging',
      playbook,
      next_action_at: scheduledAt.toISOString(),
    });

    return { contactId, nurtureStage: 'engaging', path: 'comment', commentTaskId: data.id as string };
  }

  // Connect-direct path: no recent post found.
  const connectNote = await draftEngagerMessage(
    client,
    userId,
    workspaceId,
    contact,
    agenda,
    dossier,
    'linkedin_connect',
  );
  playbook = markStep(markStep(playbook, 'research', 'done'), 'comment', 'skipped');
  const due = connectDueAt(playbook);

  await updateWarmContact(client, userId, contactId, {
    ...basePatch,
    nurture_stage: 'connect_ready',
    playbook,
    outreach_draft: connectNote,
    outreach_channel: 'linkedin_connect',
    status: 'drafted',
    next_action_at: due.toISOString(),
  });

  return { contactId, nurtureStage: 'connect_ready', path: 'connect-direct' };
}

// --- Advance after comment sent ---------------------------------------------

/** After an engager's comment task posts, draft the connect note and move to connect_ready. */
export async function advanceEngagersAfterSentComments(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await client.database
    .from('engagement_tasks')
    .select('warm_contact_id')
    .eq('workspace_id', workspaceId)
    .eq('source', 'engager_nurture')
    .eq('status', 'sent')
    .not('warm_contact_id', 'is', null)
    .limit(20);
  if (error) throw error;

  const agendaProfile = await getActiveIcpProfile(client, workspaceId);
  const agenda = agendaProfile ? resolveAgenda(agendaProfile) : defaultAgenda();

  let advanced = 0;
  for (const row of data ?? []) {
    const contactId = (row as { warm_contact_id: string }).warm_contact_id;
    const contact = await getWarmContact(client, userId, contactId);
    if (!contact || contact.nurture_stage !== 'engaging') continue;

    try {
      const dossier = (contact.dossier_json as EngagerDossier | null) ?? null;
      const connectNote = await draftEngagerMessage(
        client,
        userId,
        workspaceId,
        contact,
        agenda,
        dossier,
        'linkedin_connect',
      );
      const playbook = markStep(
        (contact.playbook as LeadPlaybook | null) ?? buildEngagerPlaybook(contact, agenda, dossier),
        'comment',
        'done',
      );
      const due = connectDueAt(playbook);
      await updateWarmContact(client, userId, contactId, {
        nurture_stage: 'connect_ready',
        playbook,
        outreach_draft: connectNote,
        outreach_channel: 'linkedin_connect',
        status: 'drafted',
        next_action_at: due.toISOString(),
      });
      advanced++;
    } catch (err) {
      logError('engager-nurture comment advance failed', {
        contactId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return advanced;
}

// --- Auto-send connects ------------------------------------------------------

/** Sends due connect invites for connect_ready engagers under safety caps. */
export async function autoSendDueEngagerConnects(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ sent: number; blocked: number; errors: string[] }> {
  const settings = await getSafetySettings(client, workspaceId);
  if (!settings.auto_send_enabled || !settings.outreach_enabled || settings.dry_run) {
    return { sent: 0, blocked: 0, errors: [] };
  }

  const { data, error } = await client.database
    .from('warm_contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('nurture_stage', 'connect_ready')
    .neq('status', 'sent')
    .lte('next_action_at', now.toISOString())
    .order('priority_score', { ascending: false })
    .limit(MAX_SEND_PER_RUN);
  if (error) throw error;

  let sent = 0;
  let blocked = 0;
  const errors: string[] = [];

  for (const row of data ?? []) {
    const contactId = (row as { id: string }).id;
    const guard = await assertAutoSendAllowed(client, workspaceId, 'linkedin_connect');
    if (!guard.allowed) {
      blocked++;
      errors.push(guard.reason ?? 'Auto-send blocked.');
      break;
    }

    const result = await sendWarmContactConnect(client, workspaceId, userId, contactId);
    if (!result.ok) {
      if (result.retryAfterSeconds) blocked++;
      errors.push(result.message);
      if (result.retryAfterSeconds) break;
      continue;
    }

    const contact = await getWarmContact(client, userId, contactId);
    const playbook = contact?.playbook
      ? markStep(contact.playbook as LeadPlaybook, 'connect', 'done')
      : undefined;
    await updateWarmContact(client, userId, contactId, {
      nurture_stage: 'connect_sent',
      ...(playbook ? { playbook } : {}),
      next_action_at: dmDueAt(now).toISOString(),
    });
    sent++;
    logInfo('engager-nurture auto connect sent', { workspaceId, contactId });

    const jitter =
      guard.settings.min_seconds_between_sends * 1000 +
      Math.floor(Math.random() * guard.settings.max_jitter_seconds * 1000);
    await sleep(jitter);
  }

  return { sent, blocked, errors };
}

// --- DM follow-up (after connect accepted) -----------------------------------

/** For connect_sent engagers past due: if 1st-degree, draft a DM and move to dm_ready. */
export async function prepareDueEngagerDms(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await client.database
    .from('warm_contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('nurture_stage', 'connect_sent')
    .lte('next_action_at', now.toISOString())
    .limit(MAX_PLAN_PER_RUN);
  if (error) throw error;

  const agendaProfile = await getActiveIcpProfile(client, workspaceId);
  const agenda = agendaProfile ? resolveAgenda(agendaProfile) : defaultAgenda();

  let prepared = 0;
  for (const row of data ?? []) {
    const contactId = (row as { id: string }).id;
    const contact = await getWarmContact(client, userId, contactId);
    if (!contact) continue;
    const identifier = contactIdentifier(contact);
    if (!identifier) continue;

    const connected = await isLinkedInFirstDegree(
      client,
      userId,
      workspaceId,
      identifier,
      contact.provider_profile_id,
    );
    if (!connected) {
      // Not accepted yet - check again in a couple days.
      const retry = new Date(now);
      retry.setUTCDate(retry.getUTCDate() + 2);
      await updateWarmContact(client, userId, contactId, { next_action_at: retry.toISOString() });
      continue;
    }

    try {
      const dossier = (contact.dossier_json as EngagerDossier | null) ?? null;
      const dm = await draftEngagerMessage(client, userId, workspaceId, contact, agenda, dossier, 'linkedin_dm');
      await updateWarmContact(client, userId, contactId, {
        nurture_stage: 'dm_ready',
        outreach_draft: dm,
        outreach_channel: 'linkedin_dm',
        next_action_at: now.toISOString(),
      });
      prepared++;
    } catch (err) {
      logError('engager-nurture dm prepare failed', {
        contactId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return prepared;
}

/** Auto-sends due DMs for dm_ready engagers under safety caps. */
export async function autoSendDueEngagerDms(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ sent: number; blocked: number; errors: string[] }> {
  const settings = await getSafetySettings(client, workspaceId);
  if (!settings.auto_send_enabled || !settings.outreach_enabled || settings.dry_run) {
    return { sent: 0, blocked: 0, errors: [] };
  }

  const { data, error } = await client.database
    .from('warm_contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('nurture_stage', 'dm_ready')
    .lte('next_action_at', now.toISOString())
    .limit(MAX_SEND_PER_RUN);
  if (error) throw error;

  let sent = 0;
  let blocked = 0;
  const errors: string[] = [];

  for (const row of data ?? []) {
    const contactId = (row as { id: string }).id;
    const guard = await assertAutoSendAllowed(client, workspaceId, 'linkedin_dm');
    if (!guard.allowed) {
      blocked++;
      errors.push(guard.reason ?? 'DM auto-send blocked.');
      break;
    }

    const result = await sendWarmContactDm(client, workspaceId, userId, contactId);
    if (!result.ok) {
      if (result.retryAfterSeconds) blocked++;
      errors.push(result.message);
      if (result.retryAfterSeconds) break;
      continue;
    }

    const contact = await getWarmContact(client, userId, contactId);
    const playbook = contact?.playbook
      ? markStep(contact.playbook as LeadPlaybook, 'dm', 'done')
      : undefined;
    await updateWarmContact(client, userId, contactId, {
      nurture_stage: 'dm_sent',
      ...(playbook ? { playbook } : {}),
      next_action_at: null,
    });
    sent++;
    logInfo('engager-nurture auto DM sent', { workspaceId, contactId });

    const jitter =
      guard.settings.min_seconds_between_sends * 1000 +
      Math.floor(Math.random() * guard.settings.max_jitter_seconds * 1000);
    await sleep(jitter);
  }

  return { sent, blocked, errors };
}

// --- Auto-plan new engagers --------------------------------------------------

/**
 * Plans the top new ICP / potential-lead engagers that haven't started the
 * sequence yet. Bounded per run so a big sync doesn't fan out into a burst of
 * LLM + Unipile calls.
 */
export async function autoPlanNewEngagers(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const settings = await getSafetySettings(client, workspaceId);
  if (!settings.auto_send_enabled || !settings.outreach_enabled || settings.dry_run) {
    return 0;
  }

  const { data, error } = await client.database
    .from('warm_contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'new')
    .in('category', ['ICP', 'Potential Lead'])
    .eq('nurture_stage', 'discovered')
    .order('last_synced_at', { ascending: false })
    .limit(MAX_PLAN_PER_RUN);
  if (error) throw error;

  const agendaProfile = await getActiveIcpProfile(client, workspaceId);
  const agenda = agendaProfile ? resolveAgenda(agendaProfile) : defaultAgenda();
  if (!agenda.sources.includes('engagers')) return 0;

  let planned = 0;
  for (const row of data ?? []) {
    const contactId = (row as { id: string }).id;
    try {
      await planEngagerNurture(client, userId, workspaceId, contactId, agenda);
      planned++;
    } catch (err) {
      logError('engager-nurture plan failed', {
        contactId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return planned;
}

// --- Orchestrator ------------------------------------------------------------

export interface EngagerNurtureResult {
  planned: number;
  commentsAdvanced: number;
  connectsSent: number;
  dmsPrepared: number;
  dmsSent: number;
  blocked: number;
  errors: string[];
}

/** Full engager-nurture pass for one workspace (used by the cron). */
export async function runEngagerNurtureForWorkspace(
  client: InsforgeClient,
  workspaceId: string,
): Promise<EngagerNurtureResult> {
  const empty: EngagerNurtureResult = {
    planned: 0,
    commentsAdvanced: 0,
    connectsSent: 0,
    dmsPrepared: 0,
    dmsSent: 0,
    blocked: 0,
    errors: [],
  };
  const userId = await getWorkspaceOwnerUserId(client, workspaceId);
  if (!userId) return { ...empty, errors: ['No workspace owner.'] };

  try {
    const planned = await autoPlanNewEngagers(client, workspaceId, userId);
    const commentsAdvanced = await advanceEngagersAfterSentComments(client, workspaceId, userId);
    const connects = await autoSendDueEngagerConnects(client, workspaceId, userId);
    const dmsPrepared = await prepareDueEngagerDms(client, workspaceId, userId);
    const dms = await autoSendDueEngagerDms(client, workspaceId, userId);
    return {
      planned,
      commentsAdvanced,
      connectsSent: connects.sent,
      dmsPrepared,
      dmsSent: dms.sent,
      blocked: connects.blocked + dms.blocked,
      errors: [...connects.errors, ...dms.errors],
    };
  } catch (err) {
    return { ...empty, errors: [err instanceof Error ? err.message : String(err)] };
  }
}
