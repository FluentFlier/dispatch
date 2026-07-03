import { getComposioClient } from '@/lib/composio/client';

export interface ComposioExecuteResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function executeComposioTool<T = unknown>(
  composioUserId: string,
  slug: string,
  arguments_: Record<string, unknown>,
): Promise<ComposioExecuteResult<T>> {
  const composio = getComposioClient();
  if (!composio) {
    return { success: false, error: 'Composio is not configured (COMPOSIO_API_KEY missing).' };
  }

  try {
    // Composio SDK v0.13+ requires an explicit toolkit version for manual tool
    // execution; passing 'latest' is NOT accepted — it must be an exact pinned
    // version string (e.g. '20250909_00') or the skip flag.
    // dangerouslySkipVersionCheck lets the backend resolve the active version,
    // equivalent to the old 'latest' behaviour.
    const result = await composio.tools.execute(slug, {
      userId: composioUserId,
      arguments: arguments_,
      dangerouslySkipVersionCheck: true,
    });

    const payload = result as { successful?: boolean; error?: string; data?: T };
    if (payload.successful === false) {
      return { success: false, error: payload.error ?? 'Composio tool execution failed.' };
    }

    return { success: true, data: payload.data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
