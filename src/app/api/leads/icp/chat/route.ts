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

interface ChatIntent {
  reply: string;
  /** Full, merged ICP description when the user is defining or changing it; empty to leave unchanged. */
  icp_description: string;
  /** True when the user asks to search/find leads now. */
  run_discovery: boolean;
}

/** Pull the first JSON object out of an LLM reply, tolerating prose or ``` fences. */
function extractJson(raw: string): ChatIntent | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<ChatIntent>;
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : '',
      icp_description: typeof obj.icp_description === 'string' ? obj.icp_description.trim() : '',
      run_discovery: obj.run_discovery === true,
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
      'You help a founder define their Ideal Customer Profile (ICP) for B2B lead discovery.',
      'Leads come from startup directories (YC, Product Hunt). The ICP is a natural-language brief.',
      'Given the current ICP and the latest message, decide the intent and reply conversationally.',
      'Respond with ONLY a JSON object, no prose, with exactly these keys:',
      '{"reply": string, "icp_description": string, "run_discovery": boolean}',
      '- reply: 1-3 short sentences to the user, warm and concrete. If run_discovery is true, do',
      '  NOT say you are searching or that you found leads - you cannot search from here. Instead',
      '  confirm the ICP looks ready and tell them to hit the "Find leads now" button to start.',
      '- icp_description: if the user is defining or CHANGING their ICP, return the FULL updated brief',
      '  (merge their change into the current ICP). If they are only asking to search or just chatting,',
      '  return an empty string so the saved ICP is left unchanged.',
      '- run_discovery: true ONLY if the user asks to find/search/pull/get leads now.',
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
