import { getServerClient } from '@/lib/insforge/server';
import { getAppUrl } from '@/lib/env';
import type {
  ConnectedSocialAccount,
  PublishPayload,
  PublishResult,
  SocialPlatform,
  SocialProvider,
} from '@/lib/social/types';

function getUnipileBase(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN is not configured');
  // DSN format: api54.unipile.com:18402 — ensure no trailing slash
  return `https://${dsn.replace(/\/$/, '')}/api/v1`;
}

function getApiKey(): string {
  const key = process.env.UNIPILE_API_KEY;
  if (!key) throw new Error('UNIPILE_API_KEY is not configured');
  return key;
}

async function unipoleFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${getUnipileBase()}${path}`, {
    ...options,
    headers: {
      'X-API-KEY': getApiKey(),
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
  });
}

function mapPlatform(p: string): SocialPlatform | null {
  const n = p.toLowerCase();
  if (n === 'twitter' || n === 'x' || n === 'twitter_v2') return 'twitter';
  if (n === 'linkedin') return 'linkedin';
  if (n === 'instagram') return 'instagram';
  if (n === 'threads') return 'threads';
  return null;
}

export const unipileProvider: SocialProvider = {
  name: 'unipile',

  /**
   * Reads connected accounts from the social_accounts table.
   * These are populated by the Unipile webhook on account.connected events.
   */
  async listAccounts(userId: string): Promise<ConnectedSocialAccount[]> {
    const client = getServerClient();
    const { data } = await client.database
      .from('social_accounts')
      .select('platform, account_name, account_id, unipile_account_id')
      .eq('user_id', userId)
      .not('unipile_account_id', 'is', null);

    return (data ?? []).map((row) => ({
      platform: row.platform as SocialPlatform,
      accountName: row.account_name ?? null,
      accountId: row.unipile_account_id ?? null,
      healthStatus: 'connected',
      provider: 'unipile' as const,
    }));
  },

  /**
   * Returns the hosted-connect URL for OAuth account linking via Unipile.
   */
  async getConnectUrl(_userId: string): Promise<string | null> {
    return `${getAppUrl()}/api/social-accounts/connect/unipile`;
  },

  /**
   * Publishes a post via Unipile using the user's connected account_id for the platform.
   */
  async publish(userId: string, payload: PublishPayload): Promise<PublishResult> {
    const client = getServerClient();
    const { data: row } = await client.database
      .from('social_accounts')
      .select('unipile_account_id')
      .eq('user_id', userId)
      .eq('platform', payload.platform)
      .not('unipile_account_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!row?.unipile_account_id) {
      return {
        success: false,
        error: `No Unipile account connected for ${payload.platform}`,
        provider: 'unipile',
      };
    }

    const body: Record<string, unknown> = {
      account_id: row.unipile_account_id,
      text: payload.text,
    };

    if (payload.imageUrl) {
      body.media_urls = [payload.imageUrl];
    }

    const res = await unipoleFetch('/posts', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        success: false,
        error: `Unipile publish failed (${res.status}): ${err.slice(0, 200)}`,
        provider: 'unipile',
      };
    }

    const json = (await res.json()) as { id?: string; object?: string };
    return {
      success: true,
      platformPostId: json.id,
      provider: 'unipile',
    };
  },
};

interface UnipileFullAccount {
  id: string;
  username?: string;
  name?: string;
  connection_params?: {
    im?: { username?: string; publicIdentifier?: string };
  };
}

/**
 * Fetches full account details from Unipile including connection_params.
 * Webhook payloads only carry a bare account object (no connection_params),
 * so account_id stored there is just `username`. Calling this after webhook
 * upsert gives us publicIdentifier — the LinkedIn provider user ID required
 * for GET /users/{id}/posts.
 */
export async function fetchUnipileAccountDetails(unipileAccountId: string): Promise<UnipileFullAccount | null> {
  try {
    const res = await unipoleFetch(`/accounts/${encodeURIComponent(unipileAccountId)}`, { method: 'GET' });
    if (!res.ok) return null;
    return res.json() as Promise<UnipileFullAccount>;
  } catch {
    return null;
  }
}

export { unipoleFetch, mapPlatform };
