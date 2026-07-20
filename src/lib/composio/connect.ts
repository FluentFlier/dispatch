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
  requestOrigin?: string,
): Promise<ComposioLinkResult> {
  const composio = getComposioClient();
  if (!composio) {
    throw new Error('Composio is not configured.');
  }

  const authConfigId = getComposioAuthConfigId(toolkit);
  if (!authConfigId) {
    const envKeys: Record<ComposioToolkit, string> = {
      slack: 'COMPOSIO_SLACK_AUTH_CONFIG_ID',
      gmail: 'COMPOSIO_GMAIL_AUTH_CONFIG_ID',
      googlecalendar: 'COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID',
    };
    throw new Error(`Missing auth config for ${toolkit}. Set ${envKeys[toolkit]}.`);
  }

  const composioUserId = toComposioUserId(workspaceId, userId);
  const state = encodeComposioState({ workspaceId, userId, toolkit, returnTo });

  const connection = await composio.connectedAccounts.link(composioUserId, authConfigId, {
    callbackUrl: `${composioCallbackUrl(requestOrigin)}?state=${encodeURIComponent(state)}`,
  });

  if (!connection.redirectUrl) {
    throw new Error('Composio did not return a redirect URL.');
  }

  return { redirectUrl: connection.redirectUrl, composioUserId };
}

/**
 * Live connection state for a toolkit, or `null` when Composio could not be
 * asked. Tri-state on purpose: "definitely not connected" and "we don't know"
 * must not collapse into the same value, or an outage reads as a disconnection.
 */
export async function isComposioToolkitConnected(
  composioUserId: string,
  toolkit: ComposioToolkit,
): Promise<boolean | null> {
  const composio = getComposioClient();
  if (!composio) return null;

  try {
    const response = await composio.connectedAccounts.list({
      userIds: [composioUserId],
      toolkitSlugs: [COMPOSIO_TOOLKIT_SLUGS[toolkit]],
    });
    const items = (response as { items?: Array<{ status?: string }> }).items ?? [];
    return items.some((item) => item.status === 'ACTIVE');
  } catch (err) {
    // null, NOT false. A rate limit, outage, revoked key, or a key rotated to a
    // different Composio project used to return false here, which the UI renders
    // identically to "this user never connected" - the reported "Gmail says not
    // connected but it is". The caller falls back to the stored connection flag
    // when the probe cannot answer, so an unreachable Composio degrades to the
    // last known state instead of silently claiming a disconnection.
    console.warn('[composio] status probe failed', {
      toolkit,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Revokes a toolkit's Composio connection for one entity, deleting every
 * connected account it holds. Returns how many were removed, or null when
 * Composio could not be reached (same tri-state contract as the probe above).
 *
 * Disconnect routes previously only cleared a DB flag. Since the status badge
 * reads the LIVE Composio state, clearing the flag left the account genuinely
 * connected and the UI still showing "Connected" - the button did nothing, and
 * the OAuth grant survived a disconnect the user believed had happened. Revoke
 * at the provider first; the DB flag is bookkeeping, not the grant.
 */
export async function disconnectComposioToolkit(
  composioUserId: string,
  toolkit: ComposioToolkit,
): Promise<number | null> {
  const composio = getComposioClient();
  if (!composio) return null;

  try {
    const response = await composio.connectedAccounts.list({
      userIds: [composioUserId],
      toolkitSlugs: [COMPOSIO_TOOLKIT_SLUGS[toolkit]],
    });
    const items = (response as { items?: Array<{ id?: string }> }).items ?? [];
    let removed = 0;
    for (const item of items) {
      if (!item.id) continue;
      await composio.connectedAccounts.delete(item.id);
      removed += 1;
    }
    return removed;
  } catch (err) {
    console.warn('[composio] disconnect failed', {
      toolkit,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
