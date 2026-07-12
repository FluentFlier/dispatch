/**
 * Langfuse tracing wrapper (spec 4.2). LOUD ABSENCE HANDLING: without
 * LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY every helper is a transparent
 * no-op after ONE console.warn. Tracing must never crash prod and never
 * change pipeline behavior - withSpan always returns fn()'s value and always
 * propagates fn()'s errors.
 *
 * Serverless gotcha (Langfuse Vercel guide): spans are exported async; a
 * function freeze after the response loses them. flushAfterResponse() hands
 * processor.forceFlush() to Vercel's waitUntil so the export finishes after
 * the response without adding latency. Off Vercel it falls back to a
 * fire-and-forget flush.
 */
import { getLangfuseProcessor } from './langfuse-processor';

export function langfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim());
}

let warnedOnce = false;
function warnDisabled(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn('[observability] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set - generation tracing disabled (no-op).');
}

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!langfuseEnabled()) {
    warnDisabled();
    return fn();
  }
  const { startActiveObservation } = await import('@langfuse/tracing');
  return startActiveObservation(name, async (span) => {
    span.update({ metadata: attrs });
    return fn();
  });
}

/** Attach attributes to the currently active observation, if any. Safe no-op. */
export async function updateSpanAttrs(
  attrs: Record<string, string | number | boolean | undefined>,
): Promise<void> {
  if (!langfuseEnabled()) return;
  try {
    const { updateActiveObservation } = await import('@langfuse/tracing');
    updateActiveObservation({ metadata: attrs });
  } catch {
    // attribute loss is acceptable; generation is not
  }
}

export function flushAfterResponse(): void {
  const processor = getLangfuseProcessor();
  if (!processor) return;
  const flushPromise = processor
    .forceFlush()
    .catch((err: unknown) => console.warn('[observability] langfuse flush failed', err));
  void import('@vercel/functions')
    .then(({ waitUntil }) => waitUntil(flushPromise))
    .catch(() => {
      // Not on Vercel (local dev, tsx eval runs): flushPromise already running
      // fire-and-forget, nothing more to do.
    });
}
