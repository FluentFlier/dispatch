import { getServerClient } from '@/lib/insforge/server';
import { getAppUrl } from '@/lib/env';
import { detectImageType } from '@/lib/image-type';
import { getUnipileApiBase, getUnipileApiKey } from '@/lib/unipile/config';
import type {
  ConnectedSocialAccount,
  PublishPayload,
  PublishResult,
  SocialPlatform,
  SocialProvider,
} from '@/lib/social/types';

function getUnipileBase(): string {
  const base = getUnipileApiBase();
  if (!base) throw new Error('UNIPILE_DSN is not configured');
  return base;
}

function getApiKey(): string {
  const key = getUnipileApiKey();
  if (!key) throw new Error('UNIPILE_API_KEY is not configured');
  return key;
}

async function unipoleFetch(path: string, options: RequestInit = {}): Promise<Response> {
  // For multipart (FormData) bodies we must NOT set Content-Type ourselves —
  // fetch has to set `multipart/form-data; boundary=...`. Forcing
  // application/json here is exactly what made POST /posts fail with a schema
  // "invalid_parameters" 400. JSON callers are unaffected.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    'X-API-KEY': getApiKey(),
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };
  return fetch(`${getUnipileBase()}${path}`, { ...options, headers });
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

    // POST /api/v1/posts is a file-carrying endpoint: it requires
    // multipart/form-data, NOT JSON. Required fields are account_id + text;
    // media is attached as binary file parts named `attachments` (there is no
    // `media_urls` field). See Unipile "Create a post" reference.
    const form = new FormData();
    form.append('account_id', row.unipile_account_id);
    form.append('text', payload.text);

    if (payload.imageUrl) {
      try {
        const imgRes = await fetch(payload.imageUrl);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          // Storage/CDN often serves images as application/octet-stream, which
          // LinkedIn rejects with 415 "unsupported_media_type". Detect the real
          // image type from magic bytes so we send a correct mime + extension.
          const { mime, ext } = detectImageType(buf, imgRes.headers.get('content-type'));
          form.append('attachments', new Blob([new Uint8Array(buf)], { type: mime }), `image.${ext}`);
        }
      } catch {
        // Publish the text even if the image can't be fetched.
      }
    }

    const res = await unipoleFetch('/posts', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        success: false,
        error: `Unipile publish failed (${res.status}): ${err.slice(0, 500)}`,
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

export interface UnipileFullAccount {
  id: string;
  username?: string;
  name?: string;
  connection_params?: {
    im?: {
      username?: string;
      publicIdentifier?: string;
      /** LinkedIn numeric member ID (used in /users/{id}/posts path) */
      memberId?: string;
      /** LinkedIn internal ID — may be numeric or ACo... encoded */
      id?: string;
      objectUrn?: string;
      entityUrn?: string;
    };
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
