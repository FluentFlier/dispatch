import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getWorkspaceOwnerUserId } from '@/lib/signals/ingest/workspace-account';
import { updateDirectorySettings, getDirectorySettings } from '@/lib/signals/leads/store';
import { putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';
import { parseIcpDescription } from '@/lib/signals/icp/parse-description';
import { syncWorkspaceDirectory } from '@/lib/signals/ingest/sync-directory';
import { chatCompletion, LlmError } from '@/lib/llm';
import { errorResponse } from '@/lib/api-errors';

/**
 * Friendly, HONEST reply when the AI provider is out of credits / rate-limited.
 * Returned as a normal 200 assistant message so the user sees WHY in the chat and
 * knows it is our provider capacity — not their account or subscription.
 */
function llmBusyResponse(): NextResponse {
  return NextResponse.json(
    {
      assistantMessage:
        "Our AI is temporarily over capacity on our end — this is a provider-credit issue on our side, not your account or subscription. Please try again in a few minutes.",
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
 * turn — refine the ICP, run discovery, or just answer — then reuses the same
 * parse/persist/discover primitives so the chat and one-shot flows stay in sync.
 * Returns the shape IcpChat.tsx consumes: { assistantMessage, settings, applied,
 * discoveryRan, sync }.
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
      '- reply: 1-3 short sentences to the user, warm and concrete.',
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

    let intent: ChatIntent | null = null;
    try {
      const raw = await chatCompletion(system, userPrompt, { maxTokens: 600, temperature: 0.4 });
      intent = extractJson(raw);
    } catch (err) {
      if (isLlmUnavailable(err)) return llmBusyResponse();
      return errorResponse('ICP assistant is unavailable right now.', 503, err);
    }
    if (!intent) {
      return NextResponse.json(
        { assistantMessage: 'I could not parse that — try rephrasing your ICP or say "find leads now".' },
        { status: 200 },
      );
    }

    let applied = false;
    // Persist ICP only when the user actually changed it (non-empty and different).
    if (intent.icp_description && intent.icp_description !== currentIcp) {
      const icp = await parseIcpDescription(intent.icp_description);
      await updateDirectorySettings(client, workspaceId, {
        icp_description: intent.icp_description,
        icp_verticals: icp.icp_verticals,
        icp_keywords: icp.icp_keywords,
      });
      const ownerId = (await getWorkspaceOwnerUserId(client, workspaceId)) ?? user.id;
      await putBrainPage(client, ownerId, {
        slug: BRAIN_SLUG.gtm,
        title: 'GTM playbook',
        tags: ['gtm', 'signals', 'outreach'],
        body: JSON.stringify({ ...icp.gtm, status: 'ready' }, null, 2),
        workspaceId,
      });
      applied = true;
    }

    let sync = null;
    let discoveryRan = false;
    if (intent.run_discovery) {
      sync = await syncWorkspaceDirectory(client, workspaceId);
      discoveryRan = true;
    }

    const settings = await getDirectorySettings(client, workspaceId);

    return NextResponse.json({
      assistantMessage: intent.reply || 'Done.',
      settings,
      applied,
      discoveryRan,
      sync,
    });
  } catch (err) {
    // A quota/credit failure from ICP parsing or discovery is our provider being
    // out of credits — surface it honestly instead of a generic 500.
    if (isLlmUnavailable(err)) return llmBusyResponse();
    return errorResponse('Could not process ICP chat.', 500, err);
  }
}
