import { getComposioClient, toComposioUserId } from '@/lib/composio/client';
import {
  composioCallbackUrl,
  getComposioAuthConfigId,
  COMPOSIO_TOOLKIT_SLUGS,
  type ComposioToolkit,
} from '@/lib/composio/config';
import { encodeComposioState } from '@/lib/composio/state';

export interface ComposioLinkResult {
  redirectUrl: string;
  composioUserId: string;
}

export async function startComposioConnect(
  workspaceId: string,
  userId: string,
  toolkit: ComposioToolkit,
  returnTo?: string,
): Promise<ComposioLinkResult> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error('Composio is not configured.');
  }

  const authConfigId = getComposioAuthConfigId(toolkit);
  if (!authConfigId) {
    throw new Error(
      `Missing auth config for ${toolkit}. Set COMPOSIO_${toolkit.toUpperCase()}_AUTH_CONFIG_ID.`,
    );
  }

  const composioUserId = toComposioUserId(workspaceId, userId);
  const state = encodeComposioState({ workspaceId, userId, toolkit, returnTo });

  const connection = await composio.connectedAccounts.link(composioUserId, authConfigId, {
    callbackUrl: `${composioCallbackUrl()}?state=${encodeURIComponent(state)}`,
  });

  if (!connection.redirectUrl) {
    throw new Error('Composio did not return a redirect URL.');
  }

  return { redirectUrl: connection.redirectUrl, composioUserId };
}

export async function isComposioToolkitConnected(
  composioUserId: string,
  toolkit: ComposioToolkit,
): Promise<boolean> {
  const composio = getComposioClient();
  if (!composio) return false;

  try {
    const response = await composio.connectedAccounts.list({
      userIds: [composioUserId],
      toolkitSlugs: [COMPOSIO_TOOLKIT_SLUGS[toolkit]],
    });
    const items = (response as { items?: Array<{ status?: string }> }).items ?? [];
    return items.some((item) => item.status === 'ACTIVE');
  } catch {
    return false;
  }
}
