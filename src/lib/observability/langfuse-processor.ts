/**
 * Holds the LangfuseSpanProcessor singleton created in src/instrumentation.ts
 * so route/pipeline code can forceFlush without importing OTel setup.
 * Null means tracing is disabled (keys absent) or instrumentation hasn't run.
 */
import type { LangfuseSpanProcessor } from '@langfuse/otel';

let processor: LangfuseSpanProcessor | null = null;

export function setLangfuseProcessor(p: LangfuseSpanProcessor): void {
  processor = p;
}

export function getLangfuseProcessor(): LangfuseSpanProcessor | null {
  return processor;
}
