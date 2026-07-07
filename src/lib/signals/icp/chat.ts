import { chatCompletion, isLlmConfigured } from '@/lib/llm';

/** One prior turn in the ICP chat thread. */
export interface IcpChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Structured outcome of a single ICP chat turn. */
export interface IcpChatDecision {
  /** Plain-text assistant reply shown in the thread. */
  reply: string;
  /**
   * Full consolidated ICP description reflecting everything learned so far, or
   * null when the turn carried no ICP info to save (a question, a greeting, or
   * a bare "find leads"). Non-null means: parse + persist + refresh the playbook.
   */
  icpDescription: string | null;
  /** True when the user asked to search for matching leads now. */
  discover: boolean;
}

const SYSTEM = [
  'You are an ICP (ideal customer profile) setup assistant for a founder GTM tool.',
  'You help the user describe who they sell to, refine it over turns, and trigger lead discovery on request.',
  'Reply with ONLY valid JSON (no markdown fence) matching this shape:',
  '{',
  '  "reply": string,            // 1-3 warm, concrete sentences. Plain text. No markdown, no bullet symbols.',
  '  "icp_description": string,  // the FULL consolidated ICP in plain English, merging everything so far. Empty string if this turn added no ICP info.',
  '  "discover": boolean         // true only if the user asked to find/search/pull leads now',
  '}',
  'Rules:',
  '- When the user describes or refines their ICP (stage, industry, geography, signals like funding/YC batch/hiring), rewrite icp_description as the complete merged description, not just the delta.',
  '- When the user only asks a question or says something unrelated to their ICP, set icp_description to "".',
  '- When the user says things like "find leads", "search now", "pull matches", set discover to true.',
  '- reply must be natural and specific to what they said. Never output JSON or code in reply. Never use asterisks, hashes, or markdown.',
].join('\n');

function extractDecision(raw: string): IcpChatDecision | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  // Grab the first {...} block so trailing prose can't break JSON.parse.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      reply?: unknown;
      icp_description?: unknown;
      discover?: unknown;
    };
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) return null;
    const desc = typeof parsed.icp_description === 'string' ? parsed.icp_description.trim() : '';
    return {
      reply,
      icpDescription: desc.length >= 10 ? desc : null,
      discover: parsed.discover === true,
    };
  } catch {
    return null;
  }
}

/** Heuristic discovery-intent fallback for when the model omits the flag. */
function looksLikeDiscovery(message: string): boolean {
  return /\b(find|search|pull|get|show|discover)\b.*\b(lead|company|companies|match|prospect)/i.test(message);
}

/**
 * Runs one conversational ICP turn: the model replies, optionally rewrites the
 * consolidated ICP description, and flags whether to run discovery now. Kept
 * separate from the route so the LLM contract is unit-testable and the route
 * stays about persistence.
 */
export async function runIcpChatTurn(params: {
  message: string;
  history: IcpChatTurn[];
  currentDescription: string | null;
}): Promise<IcpChatDecision> {
  const { message, history, currentDescription } = params;

  if (!isLlmConfigured()) {
    // No LLM: still let the user save a plain description and trigger discovery.
    return {
      reply: 'Saved. Add more detail any time, or say "find leads" to search now.',
      icpDescription: message.trim().length >= 10 ? message.trim() : null,
      discover: looksLikeDiscovery(message),
    };
  }

  const contextLines: string[] = [];
  if (currentDescription?.trim()) {
    contextLines.push(`CURRENT SAVED ICP:\n${currentDescription.trim()}`);
  }
  if (history.length > 0) {
    const convo = history
      .slice(-10)
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n');
    contextLines.push(`CONVERSATION SO FAR:\n${convo}`);
  }
  contextLines.push(`USER'S NEW MESSAGE:\n${message.trim()}`);

  const raw = await chatCompletion(SYSTEM, contextLines.join('\n\n'), {
    temperature: 0.4,
    maxTokens: 900,
  });

  const decision = extractDecision(raw);
  if (decision) {
    // Belt-and-suspenders: honor obvious discovery intent even if the model missed it.
    if (!decision.discover && looksLikeDiscovery(message)) decision.discover = true;
    return decision;
  }

  // Model returned unparseable output — degrade gracefully without losing the turn.
  return {
    reply: 'Got it. Tell me more about who you sell to, or say "find leads" to search now.',
    icpDescription: message.trim().length >= 10 ? message.trim() : null,
    discover: looksLikeDiscovery(message),
  };
}
