/**
 * Resolve `promise`, but if it has not settled within `ms`, resolve to
 * `fallback` instead. A rejection also resolves to `fallback`. The underlying
 * promise keeps running (its result is ignored) so a slow best-effort call
 * never blocks an interactive path past the budget.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
