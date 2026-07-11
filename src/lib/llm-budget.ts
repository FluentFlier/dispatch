/**
 * GLOBAL provider spend backstop.
 *
 * WHY: every per-account (entitlements) and per-workspace (ai-budget) cap is
 * scoped to a single tenant. None of them bound TOTAL provider spend, so N
 * mass-registered accounts each generating up to their own cap can still drain
 * the shared LLM credits. This is a single day-scoped counter across the entire
 * deployment — the last line of defence for the credit balance.
 *
 * Opt-in: inert unless `LLM_DAILY_HARD_CAP` is set to a positive integer. When
 * set, the cap counts raw provider chat-completion calls (NOT user generations —
 * one generation runs several pipeline stages), because credits are consumed
 * per provider call.
 *
 * Fail-CLOSED: when the cap is configured but the counter cannot be read/written
 * (RPC missing, DB unreachable), generation is blocked. Being blind about spend
 * is exactly when to stop — the operator opted into protecting credits over
 * availability by setting the env. Requires migration
 * db/migrations/llm-global-budget.sql.
 *
 * getServiceClient is imported lazily (dynamic import) rather than at module
 * top-level: it pulls in next/headers via @/lib/insforge/server, which only
 * resolves inside a Next.js runtime. A static import broke every non-Next
 * caller of the content pipeline (e.g. the promptfoo eval CLI) even when the
 * cap is off, because ES module imports execute at load time regardless of
 * whether the cap check below ever runs.
 */

export type GlobalBudgetStatus = 'ok' | 'blocked' | 'disabled';

/** Parses the cap env. Returns null (feature off) when unset or not a positive int. */
function parseCap(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Atomically increments the global daily provider-call counter and reports
 * whether this call is within the hard cap. Call once before every provider
 * chat completion. Returns 'disabled' with no DB cost when the cap env is unset.
 */
export async function checkGlobalLlmBudget(): Promise<GlobalBudgetStatus> {
  const cap = parseCap(process.env.LLM_DAILY_HARD_CAP);
  if (cap === null) return 'disabled';

  try {
    const { getServiceClient } = await import('@/lib/insforge/server');
    const client = getServiceClient();
    const { data, error } = await (client.database as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    }).rpc('check_and_increment_global_llm_usage', { p_hard_cap: cap });

    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as
        | { status: GlobalBudgetStatus; call_count: number }
        | undefined;
      if (row?.status === 'blocked') {
        console.warn('[llm-budget] GLOBAL daily cap hit — generation paused', { cap, count: row.call_count });
        return 'blocked';
      }
      if (row?.status === 'ok') return 'ok';
    }

    // RPC returned no usable row (missing function / migration not applied).
    // Fail closed: an operator who set the cap wants credits protected even when
    // the accounting layer is broken.
    console.error('[llm-budget] global budget RPC unavailable — failing closed', { error });
    return 'blocked';
  } catch (err) {
    console.error('[llm-budget] global budget check threw — failing closed', err);
    return 'blocked';
  }
}
