/**
 * Next.js instrumentation hook (Next 14.2: requires
 * experimental.instrumentationHook = true in next.config.mjs).
 * Registers the Langfuse OTel span processor ONCE per server boot, only when
 * keys are present. Absence = one warn, zero registration, zero overhead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (!process.env.LANGFUSE_PUBLIC_KEY?.trim() || !process.env.LANGFUSE_SECRET_KEY?.trim()) {
    console.warn('[observability] Langfuse keys absent - tracing disabled for this deployment.');
    return;
  }
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const { LangfuseSpanProcessor } = await import('@langfuse/otel');
  const { setLangfuseProcessor } = await import('@/lib/observability/langfuse-processor');

  const processor = new LangfuseSpanProcessor(); // reads LANGFUSE_* env itself
  setLangfuseProcessor(processor);
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  console.log('[observability] Langfuse tracing registered.');
}
