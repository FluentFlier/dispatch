import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getWorkspaceOwnerUserId } from '@/lib/signals/ingest/workspace-account';
import { updateDirectorySettings, getDirectorySettings } from '@/lib/signals/leads/store';
import { putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';
import { parseIcpDescription } from '@/lib/signals/icp/parse-description';
import { parseTrackIntent } from '@/lib/signals/icp/parse-track-intent';
import { syncIcpKeywordsToTopics } from '@/lib/signals/leads/topic-sync';
import { addWatchlistEntry } from '@/lib/signals/watchlist';
import { defaultEnabledSources } from '@/lib/signals/leads/directory-defaults';
import { chatCompletion, LlmError } from '@/lib/llm';
import { errorResponse } from '@/lib/api-errors';

/**
 * Friendly, HONEST reply when the AI provider is out of credits / rate-limited.
 * Returned as a normal 200 assistant message so the user sees WHY in the chat and
 * knows it is our provider capacity - not their account or subscription.
 */
function llmBusyResponse(): NextResponse {
  return NextResponse.json(
    {
      assistantMessage:
        "Our AI is temporarily over capacity on our end - this is a provider-credit issue on our side, not your account or subscription. Please try again in a few minutes.",
      llmUnavailable: true,
    },
    { status: 200 },
  );
}

/** True when a failure is the AI provider being out of credits / rate-limited. */
function isLlmUnavailable(err: unknown): boolean {
  return err instanceof LlmError && err.isQuota;
}

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(40)
    .optional(),
});

/** Nouns a search command can target ("leads", "founders", "companies", ...). */
const DISCOVERY_NOUN = String.raw`(leads?|founders?|compan(?:y|ies)|startups?|prospects?|customers?|buyers?)`;

/**
 * Deterministic discovery intent. Fires even when the LLM misreads the turn OR
 * is over capacity - a search command needs no model, just the saved ICP.
 * Matches natural IMPERATIVE phrasings, not only the literal word "leads":
 * "find leads now", "find me seed-stage fintech founders in NYC", "search for
 * healthtech companies", "pull startups in Berlin". Descriptive statements that
 * merely mention the nouns near a verb ("we want to find product-market fit
 * with founders") must NOT match - a false positive burns a paid scrape - so
 * the verb has to lead the message or be explicitly requested ("can you find").
 */
const IMPERATIVE_DISCOVERY_RE = new RegExp(
  String.raw`^(?:please\s+|ok(?:ay)?[,\s]+|now\s+)?(?:find|search|pull|get|show|fetch|surface|source|scan)\b[^.!?]*\b${DISCOVERY_NOUN}\b`,
  'i',
);
const REQUESTED_DISCOVERY_RE = new RegExp(
  String.raw`\b(?:can you|could you|please|go)\s+(?:find|search|pull|get|fetch)\b[^.!?]{0,60}\b${DISCOVERY_NOUN}\b`,
  'i',
);

function isDiscoveryCommand(message: string): boolean {
  const m = message.trim();
  return IMPERATIVE_DISCOVERY_RE.test(m) || REQUESTED_DISCOVERY_RE.test(m);
}

/**
 * Deterministic guard: does this message read like an ICP definition rather than
 * a greeting, a question, or a search command? Used so a weak/free classifier
 * model that returns an empty icp_description never causes ICP setup to silently
 * no-op - the raw message is saved as the brief instead.
 */
function looksLikeIcpDescription(message: string): boolean {
  const m = message.trim();
  if (m.split(/\s+/).length < 4) return false; // too short to be a real brief
  if (/\?\s*$/.test(m)) return false; // a question, not a definition
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|sure)\b/i.test(m)) return false;
  return true;
}

/**
 * Deterministic monitoring-intent guard. A message that clearly asks to WATCH
 * entities/programs for events or field changes and be notified must NEVER be
 * saved as an ICP: the free classifier sometimes mislabels these as ICP
 * definitions and fabricates a generic profile (the "hallucinated fintech ICP"
 * bug). This backstop fires independently of the model so a monitoring turn can
 * never pollute the ICP, even when the classifier returns no `monitor` block.
 * Needs BOTH a watch verb and a change/event subject so genuine ICP briefs that
 * merely mention "funding" ("we sell to founders who raised funding") don't trip.
 */
const MONITOR_VERB_RE = /\b(track|monitor|watch|notify|alert|keep an eye|updates? on|get updated|let me know when)\b/i;
const MONITOR_SUBJECT_RE = /\b(chang(?:e|es|ed|ing)|funding|raised|announce\w*|joins?|joined|got into|speedrun|hf0|accelerator|batch|rename\w*|new (?:ceo|founder|name))\b/i;
function looksLikeMonitorRequest(message: string): boolean {
  const m = message.trim();
  return MONITOR_VERB_RE.test(m) && MONITOR_SUBJECT_RE.test(m);
}

/** A specific company/founder/program the user wants to watch for changes. */
interface MonitorTarget {
  name: string;
  xHandle?: string;
  linkedinCompanyUrl?: string;
}

interface ChatIntent {
  reply: string;
  /** Full, merged ICP description when the user is defining or changing it; empty to leave unchanged. */
  icp_description: string;
  /** True when the user asks to search/find leads now. */
  run_discovery: boolean;
  /**
   * Set when the user wants to WATCH entities/programs for events or field changes
   * (funding, accelerator batches, name/CEO/title/description changes) and be
   * notified - a monitoring request, NOT an ICP definition. Null otherwise.
   */
  monitor: { targets: MonitorTarget[]; keywords: string[] } | null;
}

/** Narrows an unknown to a trimmed non-empty string, else undefined. */
function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Parses the optional `monitor` block; returns null unless it names something to watch. */
function parseMonitor(raw: unknown): ChatIntent['monitor'] {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const targets: MonitorTarget[] = Array.isArray(obj.targets)
    ? obj.targets
        .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
        .map((t) => ({
          name: optStr(t.name) ?? '',
          xHandle: optStr(t.xHandle),
          linkedinCompanyUrl: optStr(t.linkedinCompanyUrl),
        }))
        .filter((t) => t.name)
        .slice(0, 20)
    : [];
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.map((k) => optStr(k)).filter((k): k is string => Boolean(k)).slice(0, 30)
    : [];
  return targets.length || keywords.length ? { targets, keywords } : null;
}

/** Pull the first JSON object out of an LLM reply, tolerating prose or ``` fences. */
function extractJson(raw: string): ChatIntent | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<ChatIntent> & { monitor?: unknown };
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : '',
      icp_description: typeof obj.icp_description === 'string' ? obj.icp_description.trim() : '',
      run_discovery: obj.run_discovery === true,
      monitor: parseMonitor(obj.monitor),
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/leads/icp/chat
 *
 * Conversational counterpart to POST /api/leads/icp. One LLM call classifies the
 * turn - refine the ICP, run discovery, or just answer - then reuses the same
 * parse/persist primitives so the chat and one-shot flows stay in sync. Discovery
 * is NOT run here (it would block the reply for tens of seconds); when the user
 * asks to search we set `suggestRun` and the UI triggers the streamed scrape.
 * Returns the shape IcpChat.tsx consumes: { assistantMessage, settings, applied,
 * suggestRun }.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const current = await getDirectorySettings(client, workspaceId);
    const currentIcp = current?.icp_description?.trim() ?? '';

    // Deterministic "track <name>" command - adds a workspace watchlist entry
    // (X + LinkedIn sources, seeded keyword) directly, no LLM round trip needed.
    const trackIntent = parseTrackIntent(parsed.data.message);
    if (trackIntent) {
      const result = await addWatchlistEntry(client, workspaceId, {
        name: trackIntent.name,
        xHandle: trackIntent.xHandle,
        linkedinCompanyUrl: trackIntent.linkedinCompanyUrl,
        keywords: [trackIntent.name.toLowerCase()],
      });
      const sourceCount = result.sourcesCreated.length;
      return NextResponse.json({
        assistantMessage: `Tracking ${trackIntent.name} - added ${sourceCount} source${sourceCount === 1 ? '' : 's'} to your watchlist.`,
        settings: current,
        applied: false,
        suggestRun: false,
      });
    }

    const historyText = (parsed.data.history ?? [])
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const system = [
      'You help a founder set up B2B lead discovery AND lead/company monitoring.',
      'Classify the latest message into one of three intents and reply conversationally:',
      '  DEFINE ICP - the user describes who they sell to (stage, industry, roles, geography).',
      '  RUN DISCOVERY - the user asks to find/search/pull leads now.',
      '  MONITOR/TRACK - the user wants to WATCH specific companies, founders, or programs for',
      '    events or changes (funding rounds; joining an accelerator/batch such as YC, YC Speedrun,',
      '    HF0, Techstars; name/title/CEO/description/profile changes; launch or announcement posts)',
      '    and be notified. A monitoring request is NOT an ICP - never invent customer attributes for it.',
      'Respond with ONLY a JSON object, no prose, with exactly these keys:',
      '{"reply": string, "icp_description": string, "run_discovery": boolean, "monitor": {"targets": [{"name": string, "xHandle": string, "linkedinCompanyUrl": string}], "keywords": string[]} | null}',
      '- reply: 1-3 short, warm, concrete sentences. NEVER claim you already searched or found anything,',
      '  and NEVER state an ICP the user did not give (no made-up stage/industry/geography). If',
      '  run_discovery is true, tell them to hit the "Find leads now" button to start.',
      '- icp_description: if the user is defining or CHANGING their ICP, return the FULL updated brief',
      '  (merge their change into the current ICP). If they are only asking to search or just chatting,',
      '  For a MONITOR or DISCOVERY message, return an empty string - never fabricate an ICP.',
      '- run_discovery: true ONLY if the user asks to find/search/pull/get leads now.',
      '- monitor: for a MONITOR/TRACK message, extract what to watch, else null.',
      '    targets = specific named companies/founders/programs. Include xHandle (no @) or',
      '      linkedinCompanyUrl ONLY if the user gave one; otherwise omit that field.',
      '    keywords = programs/events/topics to track as keywords (e.g. "YC Speedrun", "HF0",',
      '      "raised funding", "series a"). Put accelerator, batch, and funding terms here.',
    ].join('\n');

    const userPrompt = [
      `Current ICP: ${currentIcp || '(none set yet)'}`,
      historyText ? `Recent conversation:\n${historyText}` : '',
      `Latest message: ${parsed.data.message}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const wantsDiscovery = isDiscoveryCommand(parsed.data.message);

    // Deterministic discovery response, used whenever the classifier can't run or
    // can't be parsed but the user clearly asked to find leads and an ICP exists.
    const discoveryFallback = (): NextResponse =>
      NextResponse.json({
        assistantMessage: 'On it - searching for matching leads now. This can take up to a minute.',
        settings: current,
        applied: false,
        suggestRun: true,
      });

    let intent: ChatIntent | null = null;
    try {
      const raw = await chatCompletion(system, userPrompt, { maxTokens: 600, temperature: 0.4 });
      intent = extractJson(raw);
    } catch (err) {
      // "Find leads now" must work even when the ICP classifier LLM is down - it
      // needs no model, only the already-saved ICP.
      if (wantsDiscovery && currentIcp) return discoveryFallback();
      if (isLlmUnavailable(err)) return llmBusyResponse();
      return errorResponse('ICP assistant is unavailable right now.', 503, err);
    }
    if (!intent) {
      if (wantsDiscovery && currentIcp) return discoveryFallback();
      return NextResponse.json(
        { assistantMessage: 'I could not parse that - try rephrasing your ICP or say "find leads now".' },
        { status: 200 },
      );
    }

    // MONITOR/TRACK intent: wire the workspace watchlist (X/LinkedIn sources +
    // keywords) instead of writing an ICP, then return. Field-change diffing and
    // funding/accelerator detection run automatically on watched sources +
    // keywords, so "notify me when their name/CEO/description changes" is satisfied
    // by adding them to the watchlist. Crucially we never invent an ICP here - that
    // was the bug where a monitoring request produced a hallucinated fintech ICP.
    if (intent.monitor) {
      const watchedNames: string[] = [];
      const needHandle: string[] = [];
      // Collect keyword topics to arm as VISIBLE, monitored "Topics to monitor"
      // (signal_sources keyword_search rows - what the Signals setup card shows and
      // the engine polls). A named target with no handle can only be watched as a
      // keyword; one WITH a handle gets a real X/LinkedIn source for field-change
      // diffing (name/CEO/description changes).
      const topicSeeds: string[] = [];
      for (const t of intent.monitor.targets) {
        if (t.xHandle || t.linkedinCompanyUrl) {
          await addWatchlistEntry(client, workspaceId, {
            name: t.name,
            xHandle: t.xHandle,
            linkedinCompanyUrl: t.linkedinCompanyUrl,
          });
          watchedNames.push(t.name);
        } else {
          topicSeeds.push(t.name);
          needHandle.push(t.name);
        }
      }
      topicSeeds.push(...intent.monitor.keywords);
      const topicsAdded = topicSeeds.length
        ? await syncIcpKeywordsToTopics(client, workspaceId, topicSeeds)
        : 0;

      const latest = await getDirectorySettings(client, workspaceId);
      const watchLine = watchedNames.length
        ? `Now watching ${watchedNames.join(', ')} on X and LinkedIn for profile, company, and role changes. `
        : '';
      const topicLine = topicsAdded > 0
        ? `Added ${topicsAdded} topic${topicsAdded === 1 ? '' : 's'} to monitor (see Setup > Advanced > Signals). New posts about them surface as leads within the hour. `
        : '';
      const nudge = needHandle.length
        ? `To catch name, CEO, or description changes for ${needHandle.join(', ')}, give me a handle - e.g. "track ${needHandle[0]} @handle".`
        : '';
      const assistantMessage =
        `${watchLine}${topicLine}${nudge}`.trim() ||
        'Set up monitoring. Tell me a company name plus its X or LinkedIn handle to watch it for changes.';
      return NextResponse.json({
        assistantMessage,
        settings: latest,
        applied: false,
        suggestRun: false,
        monitor: true,
      });
    }

    // Deterministic monitoring backstop: the message clearly asks to watch/track
    // and be notified, but the classifier returned no monitor block (and may have
    // hallucinated an ICP instead). Never write that ICP - confirm honestly and
    // guide the user to name specific targets so we can wire the watchlist.
    if (looksLikeMonitorRequest(parsed.data.message)) {
      const latest = await getDirectorySettings(client, workspaceId);
      return NextResponse.json({
        assistantMessage:
          'Set up to watch for those signals. To track a specific company for name, CEO, or description changes, name it with a handle - e.g. "track HF0 @hf0" or "track Speedrun https://linkedin.com/company/...".',
        settings: latest,
        applied: false,
        suggestRun: false,
        monitor: true,
      });
    }

    // Deterministic ICP-setup fallback: if the classifier returned no brief but
    // the message clearly describes an ICP (and isn't a search command), treat the
    // raw message as the brief, merging into any existing ICP. Without this, a weak
    // classifier that under-returns leaves the user "chatting" with nothing saved.
    let icpBrief = intent.icp_description;
    if (!icpBrief && !wantsDiscovery && looksLikeIcpDescription(parsed.data.message)) {
      icpBrief = currentIcp
        ? `${currentIcp}\n${parsed.data.message.trim()}`
        : parsed.data.message.trim();
    }

    let applied = false;
    // Persist ICP only when it actually changed (non-empty and different).
    if (icpBrief && icpBrief !== currentIcp) {
      const icp = await parseIcpDescription(icpBrief);
      await updateDirectorySettings(client, workspaceId, {
        icp_description: icpBrief,
        icp_verticals: icp.icp_verticals,
        icp_keywords: icp.icp_keywords,
        // The hunt goal keeps stage/geography constraints ("seed", "in NYC")
        // that web discovery consumes verbatim.
        discovery_goal: icp.discovery_goal || null,
      });
      const ownerId = (await getWorkspaceOwnerUserId(client, workspaceId)) ?? user.id;
      await putBrainPage(client, ownerId, {
        slug: BRAIN_SLUG.gtm,
        title: 'GTM playbook',
        tags: ['gtm', 'signals', 'outreach'],
        body: JSON.stringify({ ...icp.gtm, status: 'ready' }, null, 2),
        workspaceId,
      });
      // Arm the live signal engine too: mirror the ICP's keywords into
      // "Topics to monitor" (additive, capped, never deletes user topics). This
      // is why the assistant can now "write topics". Non-fatal on failure.
      try {
        await syncIcpKeywordsToTopics(client, workspaceId, icp.icp_keywords);
      } catch {
        /* topic sync is best-effort; the ICP is already saved */
      }
      applied = true;
    }

    // Discovery is intentionally NOT run here. The assistant's job is to define
    // and persist the ICP - not to fire the scrape engine inside a chat request.
    // A full sync (directory scrape + a 170s-capped agent run + per-lead resolve +
    // per-lead LLM scoring) takes tens of seconds to minutes and would block the
    // reply, which is why the assistant used to "hang for a minute". When the user
    // asks to find leads we return `suggestRun` so the UI can trigger the existing
    // streamed /api/leads/sync (progress bar, non-blocking) instead of running it
    // synchronously here.
    // Only run discovery when an ICP actually exists (saved already, or set in
    // this same turn) - searching with an empty ICP returns noise. The regex
    // fallback catches close phrasings the classifier missed.
    const hasIcpNow = Boolean(currentIcp || icpBrief);
    // Save-only rule: a turn that merely DESCRIBES an ICP saves it and never
    // auto-searches, even if the classifier claims run_discovery - the user
    // reviews first (`!applied` is that decoupling guard). But a turn that is
    // an explicit search command ("find/search/pull ...") in the user's own
    // words IS the ask, so it runs whenever an ICP exists.
    const suggestRun = wantsDiscovery
      ? hasIcpNow
      : intent.run_discovery && hasIcpNow && !applied;

    const settings = await getDirectorySettings(client, workspaceId);

    // The assistant states its concrete plan: which sources it will search and
    // when the next automatic run happens, so setup ends with no mystery.
    const SOURCE_LABELS: Record<string, string> = {
      yc_directory: 'the YC directory',
      yc_launches: 'YC launches',
      web_discovery: 'the open web',
      linkedin: 'LinkedIn',
      x: 'X',
      product_hunt: 'Product Hunt',
      manual: 'your imports',
    };
    const activeSources =
      settings.enabled_sources?.length ? settings.enabled_sources : defaultEnabledSources();
    const sourcePlan = activeSources.map((s) => SOURCE_LABELS[s] ?? s).join(', ');
    const frequency = settings.scrape_frequency ?? 'daily';
    const cadenceLine =
      frequency === 'manual'
        ? 'Automatic scraping is off - say "find leads now" whenever you want a run.'
        : `It also runs automatically on your ${String(frequency).replace(/_/g, ' ')} schedule.`;

    // When discovery is about to run, the client kicks off the streamed
    // /api/leads/sync and shows its own progress, so send a matching "on it"
    // line. If the user asked to search but has no ICP yet, nudge them to
    // describe one first instead of a dead-end "Done."
    const assistantMessage = suggestRun
      ? 'On it - searching for matching leads now. This can take up to a minute.'
      : applied
        ? `${intent.reply || 'Saved your ICP - review and edit it below.'} I'll search ${sourcePlan} when you say "find leads now". ${cadenceLine}`
        : intent.reply ||
          (wantsDiscovery
            ? 'Tell me who you sell to first, then I can search - e.g. "seed-stage fintech from YC".'
            : 'Done.');

    // icpUnderstood lets the client tell "we set up your ICP / one already exists"
    // apart from "nothing was saved" (used by the local-only debug banner).
    const icpUnderstood = applied || Boolean(currentIcp);

    return NextResponse.json({
      assistantMessage,
      settings,
      applied,
      suggestRun,
      hasIcp: hasIcpNow,
      icpUnderstood,
    });
  } catch (err) {
    // A quota/credit failure from the classify or ICP-parse LLM call is our
    // provider being out of credits - surface it honestly instead of a generic 500.
    if (isLlmUnavailable(err)) return llmBusyResponse();
    return errorResponse('Could not process ICP chat.', 500, err);
  }
}
