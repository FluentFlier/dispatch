import { NextResponse } from 'next/server';

/**
 * Return a client-safe error. The detailed cause is logged server-side (column
 * names, constraint text, stack traces) but never sent to the client, which
 * would leak schema/internal details. Use a short human message + status.
 */
export function errorResponse(
  message: string,
  status = 500,
  cause?: unknown,
): NextResponse {
  if (cause !== undefined) {
    console.error(`[api ${status}] ${message}`, cause);
  }
  return NextResponse.json({ error: message }, { status });
}

/** Convenience for the common "operation failed" 500 with server-side logging. */
export function serverError(message = 'Something went wrong. Please try again.', cause?: unknown): NextResponse {
  return errorResponse(message, 500, cause);
}
