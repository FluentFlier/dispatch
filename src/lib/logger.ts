type LogLevel = 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

function formatPayload(payload: LogPayload): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  });
}

export function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  console.log(formatPayload({ level: 'info', message, meta }));
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  console.warn(formatPayload({ level: 'warn', message, meta }));
}

export function logError(
  message: string,
  meta?: Record<string, unknown>,
  err?: unknown
): void {
  const errorMeta =
    err instanceof Error
      ? { error: err.message, stack: err.stack }
      : err
        ? { error: String(err) }
        : {};
  console.error(formatPayload({ level: 'error', message, meta: { ...meta, ...errorMeta } }));
}
