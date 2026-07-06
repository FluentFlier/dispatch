/**
 * Runs `fn` over `items` with at most `limit` tasks in flight at once, and
 * returns the results in the SAME order as `items` (result[i] corresponds to
 * items[i]), regardless of which task settles first.
 *
 * Used to bound fan-out for per-item external calls (e.g. LLM scoring) so a
 * large batch does not fire unbounded concurrent requests, while still
 * finishing far faster than a fully serial loop.
 *
 * Implementation: a fixed pool of `limit` workers each pull the next pending
 * index off a shared cursor and write into `results[index]` directly, so
 * ordering is guaranteed by index assignment rather than completion order.
 * If `fn` throws for an item, the returned promise rejects (mirrors
 * `Promise.all` semantics) - callers whose `fn` must never fail the whole
 * batch should catch/fallback inside `fn` itself.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  const poolSize = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);

  return results;
}
