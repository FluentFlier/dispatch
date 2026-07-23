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
  // For multipart (FormData) bodies we must NOT set Content-Type ourselves -
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

type VerifiableUnipilePlatform = 'linkedin' | 'twitter';

function normalizedIdentity(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let token = trimmed;
  if (/^https?:\/\//i.test(token) || token.includes('linkedin.com/')) {
    try {
      const url = new URL(token.startsWith('http') ? token : `https://${token}`);
      token = url.pathname.split('/').filter(Boolean).at(-1) ?? token;
    } catch {
      token = token.replace(/\/+$/, '');
    }
  }

  return token.replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

function urnTail(value?: string): string | null {
  if (!value?.includes(':')) return null;
  return value.split(':').filter(Boolean).at(-1) ?? null;
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => v?.trim()).filter(Boolean) as string[]));
}

function identityVariants(value?: string | null): string[] {
  return uniq([value, urnTail(value ?? undefined)])
    .map(normalizedIdentity)
    .filter(Boolean) as string[];
}

function imToProviderIds(
  im: NonNullable<NonNullable<UnipileFullAccount['connection_params']>['im']> | undefined,
  storedAccountId: string | null,
): string[] {
  return uniq([
    im?.id,
    im?.memberId,
    urnTail(im?.objectUrn),
    im?.objectUrn,
    urnTail(im?.entityUrn),
    im?.entityUrn,
    im?.publicIdentifier,
    storedAccountId,
  ]);
}

function accountIdentityTokens(account: UnipileFullAccount): Set<string> {
  const im = account.connection_params?.im;
  return new Set(
    [
      account.username,
      im?.id,
      im?.memberId,
      im?.objectUrn,
      im?.entityUrn,
      im?.publicIdentifier,
    ].flatMap(identityVariants),
  );
}

function accountMatchesStoredIdentity(account: UnipileFullAccount, storedAccountId: string | null): boolean {
  const storedTokens = identityVariants(storedAccountId);
  if (storedTokens.length === 0) return true;

  const accountTokens = accountIdentityTokens(account);
  return storedTokens.some((token) => accountTokens.has(token));
}

function accountMatchesPlatform(account: UnipileFullAccount, platform: VerifiableUnipilePlatform): boolean {
  const type = (account.type ?? account.provider ?? '').toLowerCase();
  if (platform === 'linkedin') return type === 'linkedin';
  return type === 'twitter' || type === 'x' || type === 'twitter_v2';
}

async function resolveLiveUnipileAccount(
  unipileAccountId: string,
  storedAccountId: string | null,
  platform: VerifiableUnipilePlatform,
): Promise<{ unipileAccountId: string; providerUserIds: string[]; refreshed: boolean } | null> {
  const full = await fetchUnipileAccountDetails(unipileAccountId);
  if (full && accountMatchesPlatform(full, platform) && accountMatchesStoredIdentity(full, storedAccountId)) {
    return {
      unipileAccountId,
      providerUserIds: imToProviderIds(full.connection_params?.im, storedAccountId),
      refreshed: false,
    };
  }

  if (!storedAccountId) return null;
  const accounts = await listUnipileAccounts();
  const match = accounts.find((account) => {
    if (!accountMatchesPlatform(account, platform)) return false;
    return accountMatchesStoredIdentity(account, storedAccountId);
  });

  if (!match) return null;
  return {
    unipileAccountId: match.id,
    providerUserIds: imToProviderIds(match.connection_params?.im, storedAccountId),
    refreshed: match.id !== unipileAccountId,
  };
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
    if (!getUnipileApiBase() || !getUnipileApiKey()) {
      return {
        success: false,
        error:
          'Unipile is not configured. Set UNIPILE_API_KEY and UNIPILE_DSN before publishing.',
        provider: 'unipile',
      };
    }

    const client = getServerClient();
    const { data: row } = await client.database
      .from('social_accounts')
      .select('unipile_account_id, account_id')
      .eq('user_id', userId)
      .eq('platform', payload.platform)
      .not('unipile_account_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!row?.unipile_account_id) {
      return {
        success: false,
        error: `No Unipile account connected for ${payload.platform}. Connect it in Settings before publishing.`,
        provider: 'unipile',
      };
    }

    let unipileAccountId = row.unipile_account_id as string;
    if (payload.platform === 'linkedin' || payload.platform === 'twitter') {
      const target = await resolveLiveUnipileAccount(
        unipileAccountId,
        (row.account_id as string | null) ?? null,
        payload.platform,
      );

      if (!target?.unipileAccountId) {
        return {
          success: false,
          error: `No verified Unipile account connected for ${payload.platform}. Reconnect it in Settings before publishing.`,
          provider: 'unipile',
        };
      }

      if (target.refreshed) {
        await client.database
          .from('social_accounts')
          .update({ unipile_account_id: target.unipileAccountId })
          .eq('user_id', userId)
          .eq('platform', payload.platform);
      }

      unipileAccountId = target.unipileAccountId;
    }

    // POST /api/v1/posts is a file-carrying endpoint: it requires
    // multipart/form-data, NOT JSON. Required fields are account_id + text;
    // media is attached as binary file parts named `attachments` (there is no
    // `media_urls` field). See Unipile "Create a post" reference.
    const form = new FormData();
    form.append('account_id', unipileAccountId);

    // LinkedIn mentions: Unipile expects `{{i}}` placeholders in the text plus a
    // `mentions` array of {name, profile_id}. Our stored text keeps readable
    // `@Name` tokens, so substitute at the wire. Best-effort: a mention whose
    // `@Name` was edited out of the text is dropped rather than mis-tagged.
    let text = payload.text;
    if (payload.platform === 'linkedin' && payload.mentions?.length) {
      let idx = 0;
      for (const mention of payload.mentions) {
        const token = `@${mention.name}`;
        if (!text.includes(token)) continue;
        text = text.replace(token, `{{${idx}}}`);
        form.append(`mentions[${idx}][name]`, mention.name);
        form.append(`mentions[${idx}][profile_id]`, mention.profile_id);
        idx += 1;
      }
    }
    form.append('text', text);

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
  /** API list response uses 'type'; webhook payloads use 'provider'; single-account GET may omit both. */
  type?: string;
  provider?: string;
  username?: string;
  name?: string;
  connection_params?: {
    im?: {
      username?: string;
      publicIdentifier?: string;
      /** LinkedIn numeric member ID (used in /users/{id}/posts path) */
      memberId?: string;
      /** LinkedIn internal ID - may be numeric or ACo... encoded */
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
 * upsert gives us publicIdentifier - the LinkedIn provider user ID required
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

/**
 * Lists all accounts visible to the current Unipile API key.
 * Used to re-resolve a rotated account id: Unipile's `account.id` changes when a
 * LinkedIn credential session re-auths, so a cached unipile_account_id can 404.
 * Matching the stable publicIdentifier/member id against this list recovers the
 * current account id without forcing the user to reconnect.
 */
export async function listUnipileAccounts(): Promise<UnipileFullAccount[]> {
  try {
    const res = await unipoleFetch('/accounts?limit=100', { method: 'GET' });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items?: UnipileFullAccount[];
      accounts?: UnipileFullAccount[];
      data?: UnipileFullAccount[];
    };
    return json.items ?? json.accounts ?? json.data ?? [];
  } catch {
    return [];
  }
}

/**
 * Deletes a Unipile account *session* (the connector box) - NOT the underlying
 * LinkedIn account. Best-effort.
 */
export async function deleteUnipileAccount(unipileAccountId: string): Promise<boolean> {
  try {
    const res = await unipoleFetch(`/accounts/${encodeURIComponent(unipileAccountId)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Unipile mints a NEW account box on every reconnect, so the same LinkedIn piles
 * up as stale duplicate sessions in the shared tenant - clutter that also feeds
 * the account cross-wire. After an authoritative bind, delete the person's OTHER
 * boxes (same stable publicIdentifier, different id), keeping only `keepId`.
 * Matching on publicIdentifier only - never deletes a different person's box.
 *
 * DANGER, and why `knownOwnIds` exists: one Unipile API key covers dev AND
 * production, so "the person's other boxes" spans environments. Connecting the
 * same LinkedIn from a dev machine used to delete the LIVE production box;
 * Unipile then emitted a delete event and the account showed as disconnected
 * although the user never disconnected anything. Callers now pass the ids that
 * account has actually held for THIS user (from their own row), and anything
 * not on that list is left alone - an unrecognised box may well be another
 * environment's live session.
 */
export async function pruneDuplicateUnipileAccounts(
  keepId: string,
  publicIdentifier: string | null,
  knownOwnIds: string[] = [],
): Promise<number> {
  if (!publicIdentifier) return 0;
  const deletable = new Set(knownOwnIds.filter((id) => id && id !== keepId));
  if (deletable.size === 0) return 0;
  let removed = 0;
  try {
    const all = await listUnipileAccounts();
    for (const account of all) {
      if (account.id === keepId) continue;
      if (!deletable.has(account.id)) continue;
      const pid = account.connection_params?.im?.publicIdentifier ?? null;
      if (pid && pid === publicIdentifier) {
        if (await deleteUnipileAccount(account.id)) removed++;
      }
    }
  } catch {
    // Non-fatal: a failed prune only leaves clutter, never blocks the bind.
  }
  return removed;
}

export { unipoleFetch, mapPlatform };
