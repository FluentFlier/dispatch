import { getServerClient } from '@/lib/insforge/server';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { getAppUrl } from '@/lib/env';
import type {
  ConnectedSocialAccount,
  PublishPayload,
  PublishResult,
  SocialPlatform,
  SocialProvider,
} from '@/lib/social/types';

const AYRSHARE_BASE = 'https://api.ayrshare.com/api';

function getApiKey(): string {
  const key = process.env.AYRSHARE_API_KEY;
  if (!key) throw new Error('AYRSHARE_API_KEY is not configured');
  return key;
}

async function ayrshareFetch(
  path: string,
  options: RequestInit & { profileKey?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (options.profileKey) {
    headers['Profile-Key'] = options.profileKey;
  }
  const { profileKey: _pk, ...rest } = options;
  return fetch(`${AYRSHARE_BASE}${path}`, { ...rest, headers });
}

export async function getOrCreateAyrshareProfileKey(userId: string): Promise<string> {
  const client = getServerClient();

  const { data: rows } = await client.database
    .from('ayrshare_profiles')
    .select('profile_key')
    .eq('user_id', userId)
    .limit(1);

  const existing = rows?.[0] as { profile_key: string } | undefined;
  if (existing?.profile_key) {
    return decryptToken(existing.profile_key);
  }

  const res = await ayrshareFetch('/profiles/profile', {
    method: 'POST',
    body: JSON.stringify({ title: `content-os-${userId.slice(0, 8)}` }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ayrshare profile create failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { profileKey?: string; key?: string };
  const profileKey = json.profileKey ?? json.key;
  if (!profileKey) throw new Error('Ayrshare did not return profileKey');

  await client.database.from('ayrshare_profiles').insert([
    {
      user_id: userId,
      profile_key: encryptToken(profileKey),
      title: `content-os-${userId.slice(0, 8)}`,
    },
  ]);

  return profileKey;
}

function mapPlatform(p: string): SocialPlatform | null {
  const n = p.toLowerCase();
  if (n === 'twitter' || n === 'x') return 'twitter';
  if (n === 'linkedin') return 'linkedin';
  if (n === 'instagram') return 'instagram';
  if (n === 'threads') return 'threads';
  return null;
}

export const ayrshareProvider: SocialProvider = {
  name: 'ayrshare',

  async listAccounts(userId: string): Promise<ConnectedSocialAccount[]> {
    const profileKey = await getOrCreateAyrshareProfileKey(userId);
    const res = await ayrshareFetch('/user', { method: 'GET', profileKey });

    if (!res.ok) {
      return [];
    }

    const json = (await res.json()) as {
      activeSocialAccounts?: string[];
      displayNames?: Record<string, string>;
    };

    const active = json.activeSocialAccounts ?? [];
    const accounts: ConnectedSocialAccount[] = [];
    for (const p of active) {
      const platform = mapPlatform(p);
      if (!platform) continue;
      accounts.push({
        platform,
        accountName: json.displayNames?.[p] ?? p,
        accountId: null,
        healthStatus: 'connected',
        provider: 'ayrshare',
      });
    }
    return accounts;
  },

  async getConnectUrl(userId: string): Promise<string | null> {
    const profileKey = await getOrCreateAyrshareProfileKey(userId);
    const redirect = `${getAppUrl()}/settings?tab=connections&ayrshare=1`;
    const res = await ayrshareFetch('/profiles/generateJWT', {
      method: 'POST',
      profileKey,
      body: JSON.stringify({
        domain: new URL(getAppUrl()).hostname,
        private: true,
        redirect,
        logout: true,
        verify: true,
      }),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { url?: string; jwtUrl?: string };
    return json.url ?? json.jwtUrl ?? null;
  },

  async publish(userId: string, payload: PublishPayload): Promise<PublishResult> {
    const profileKey = await getOrCreateAyrshareProfileKey(userId);

    const body: Record<string, unknown> = {
      post: payload.text,
      platforms: [payload.platform === 'twitter' ? 'twitter' : payload.platform],
    };

    if (payload.imageUrl) {
      body.mediaUrls = [payload.imageUrl];
    }

    if (payload.scheduledAt) {
      body.scheduleDate = payload.scheduledAt;
    }

    const res = await ayrshareFetch('/post', {
      method: 'POST',
      profileKey,
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      status?: string;
      id?: string;
      postUrl?: string;
      errors?: Array<{ message?: string }>;
      message?: string;
    };

    if (!res.ok || json.status === 'error') {
      const err =
        json.errors?.[0]?.message ??
        json.message ??
        `Ayrshare publish failed (${res.status})`;
      return { success: false, error: err, provider: 'ayrshare' };
    }

    return {
      success: true,
      platformPostId: json.id,
      url: json.postUrl,
      provider: 'ayrshare',
    };
  },
};
