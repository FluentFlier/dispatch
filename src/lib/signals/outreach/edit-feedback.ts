import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

/** Max characters kept per stored edit side, so the table + prompt stay bounded. */
const MAX_TEXT = 2000;
/** Max characters per side when formatting an edit for the prompt (latency). */
const PROMPT_SNIPPET = 200;

interface OutreachEditRow {
  original_text: string;
  edited_text: string;
}

/**
 * Records a model-draft -> user-edited pair for a workspace when the user
 * actually changed the text before sending. Best-effort: a failure here (e.g. a
 * missing table) must never break a send, so errors are swallowed. Returns true
 * when an edit row was written.
 */
export async function recordOutreachEdit(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string | null,
  original: string | null | undefined,
  edited: string | null | undefined,
): Promise<boolean> {
  const o = (original ?? '').trim();
  const e = (edited ?? '').trim();
  // Only a real, non-trivial change is worth learning from.
  if (!e || o === e) return false;
  try {
    const { error } = await client.database.from('signal_outreach_edits').insert({
      workspace_id: workspaceId,
      lead_id: leadId,
      original_text: o.slice(0, MAX_TEXT),
      edited_text: e.slice(0, MAX_TEXT),
    });
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the last N workspace edits as compact "Before -> After" few-shot lines
 * for the draft prompt, so future drafts drift toward how this user rewrites.
 * Workspace-scoped (persists across sessions). Best-effort: returns [] on error.
 */
export async function loadEditStyleGuidance(
  client: InsforgeClient,
  workspaceId: string,
  limit = 3,
): Promise<string[]> {
  try {
    const { data } = await client.database
      .from('signal_outreach_edits')
      .select('original_text, edited_text')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    const rows = (data ?? []) as OutreachEditRow[];
    return rows
      .filter((r) => r.edited_text?.trim())
      .map(
        (r) =>
          `Before: "${(r.original_text ?? '').slice(0, PROMPT_SNIPPET)}" -> After: "${(r.edited_text ?? '').slice(0, PROMPT_SNIPPET)}"`,
      );
  } catch {
    return [];
  }
}
