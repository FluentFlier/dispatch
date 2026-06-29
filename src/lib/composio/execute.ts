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
    const result = await composio.tools.execute(slug, {
      userId: composioUserId,
      arguments: arguments_,
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
