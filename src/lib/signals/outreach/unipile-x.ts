import type { createClient } from '@insforge/sdk';
import { resolveUnipileTarget } from '@/lib/onboarding/import-posts';
import {
  parseUnipileError,
  unipileFormPost,
  unipileJsonGet,
} from '@/lib/signals/outreach/unipile-client';
import type { SendResult } from '@/lib/signals/outreach/unipile-linkedin';

type InsforgeClient = ReturnType<typeof createClient>;

export interface XProfile {
  providerId: string;
  username?: string;
}

/** Parse an X/Twitter URL or @handle into a bare username. */
export function parseXHandle(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('x.com') || trimmed.includes('twitter.com')) {
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      const parts = url.pathname.split('/').filter(Boolean);
      return (parts[0] ?? trimmed).replace(/^@/, '');
    } catch {
      return trimmed.replace(/^@/, '');
    }
  }
  return trimmed.replace(/^@/, '').replace(/\/$/, '');
}

/** Resolves the workspace/user's connected X (Twitter) Unipile account id. */
export async function getXUnipileAccountId(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<string | null> {
  let query = client.database
    .from('social_accounts')
    .select('unipile_account_id, account_id')
    .eq('user_id', userId)
    .eq('platform', 'twitter')
    .not('unipile_account_id', 'is', null);

  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data } = await query.limit(1).maybeSingle();
  const row = data as { unipile_account_id?: string | null; account_id?: string | null } | null;
  if (!row?.unipile_account_id) return null;

  const target = await resolveUnipileTarget(row.unipile_account_id, row.account_id ?? null, 'twitter');
  if (!target?.unipileAccountId) return null;
  if (target.refreshed) {
    let update = client.database
      .from('social_accounts')
      .update({ unipile_account_id: target.unipileAccountId })
      .eq('user_id', userId)
      .eq('platform', 'twitter');
    if (workspaceId) update = update.eq('workspace_id', workspaceId);
    await update;
  }
  return target.unipileAccountId;
}

/** Resolves an X handle to a Unipile provider_id (required to open a DM chat). */
export async function resolveXProfile(
  accountId: string,
  identifier: string,
): Promise<XProfile> {
  const handle = parseXHandle(identifier);
  const res = await unipileJsonGet(
    `/users/${encodeURIComponent(handle)}?account_id=${encodeURIComponent(accountId)}`,
  );

  if (!res.ok) {
    throw new Error(`X profile lookup failed: ${await parseUnipileError(res)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const providerId = String(json.provider_id ?? '');
  if (!providerId) throw new Error('X profile missing provider_id');

  return {
    providerId,
    username: json.username ? String(json.username) : handle,
  };
}

/**
 * Sends an X/Twitter direct message via Unipile. Uses the same /chats messaging
 * endpoint as LinkedIn but without the linkedin[*] params. Note X only permits
 * DMs to users whose settings allow them (typically followers or open DMs), so a
 * legitimate-looking failure here is expected for many targets.
 */
export async function sendXDirectMessage(
  accountId: string,
  providerId: string,
  text: string,
): Promise<SendResult> {
  const res = await unipileFormPost('/chats', {
    account_id: accountId,
    text: text.slice(0, 10000),
    attendees_ids: [providerId],
  });

  if (!res.ok) {
    return { success: false, error: await parseUnipileError(res) };
  }

  const json = (await res.json()) as { id?: string; chat_id?: string; object?: string };
  return { success: true, externalId: json.id ?? json.chat_id ?? json.object };
}
