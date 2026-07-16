import type { createClient } from '@insforge/sdk';
import { resolveUnipileTarget } from '@/lib/onboarding/import-posts';
import { logInfo } from '@/lib/logger';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import {
  getLinkedInApiMode,
  parseUnipileError,
  unipileFormPost,
  unipileJsonGet,
  unipileJsonPost,
} from '@/lib/signals/outreach/unipile-client';

type InsforgeClient = ReturnType<typeof createClient>;

export interface LinkedInProfile {
  providerId: string;
  publicIdentifier?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
}

export interface InMailBalance {
  available: number | null;
  raw: unknown;
}

export interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

/** Parse LinkedIn URL or handle into a Unipile public identifier */
export function parseLinkedInPublicIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.includes('linkedin.com')) {
    return trimmed.replace(/^@/, '').replace(/\/$/, '');
  }
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const inIdx = parts.indexOf('in');
    if (inIdx >= 0 && parts[inIdx + 1]) return parts[inIdx + 1];
    return parts[parts.length - 1] ?? trimmed;
  } catch {
    return trimmed;
  }
}

type StoredLinkedInAccount = {
  unipile_account_id: string | null;
  account_id: string | null;
};

/**
 * Re-resolves a possibly-stale unipile_account_id to the live one.
 *
 * Unipile re-issues account.id on every LinkedIn session re-auth (~daily), so the
 * id cached in social_accounts starts returning 404 and every outreach/verification
 * call fails with a spurious "Account not found" until the user reconnects. This
 * mirrors the publish/metrics-sync self-heal: verify the stored id, and when it is
 * stale recover the current id by the stable identity (account_id = publicIdentifier
 * / member id). Returns null when Unipile is unreachable so callers fall back to the
 * stored id - unconfigured/local environments then behave exactly as before.
 */
async function healUnipileAccountId(
  storedId: string,
  storedAccountId: string | null,
): Promise<{ accountId: string; refreshed: boolean } | null> {
  try {
    const target = await resolveUnipileTarget(storedId, storedAccountId, 'linkedin');
    if (target?.unipileAccountId) {
      return { accountId: target.unipileAccountId, refreshed: target.refreshed };
    }
  } catch {
    // Unipile unreachable / unexpected shape - caller falls back to the stored id.
  }
  return null;
}

/** Writes the recovered account id back so the next lookup hits the fast path. */
async function persistHealedAccountId(
  client: InsforgeClient,
  staleId: string,
  freshId: string,
  scope: { column: 'user_id' | 'workspace_id'; value: string },
): Promise<void> {
  await client.database
    .from('social_accounts')
    .update({ unipile_account_id: freshId })
    .eq('unipile_account_id', staleId)
    .eq('platform', 'linkedin')
    .eq(scope.column, scope.value);
  logInfo('[leads] Healed rotated Unipile account id', { [scope.column]: scope.value });
}

/**
 * Resolves the live account id for a stored row, healing + persisting a rotated id.
 * Falls back to the stored id when Unipile can't confirm (never regresses).
 */
async function liveAccountId(
  client: InsforgeClient,
  row: StoredLinkedInAccount | null,
  scope: { column: 'user_id' | 'workspace_id'; value: string },
): Promise<string | null> {
  const storedId = row?.unipile_account_id ?? null;
  if (!storedId) return null;

  const healed = await healUnipileAccountId(storedId, row?.account_id ?? null);
  if (!healed) return null;
  if (healed.refreshed) {
    await persistHealedAccountId(client, storedId, healed.accountId, scope);
  }
  return healed.accountId;
}

export async function getLinkedInUnipileAccountId(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<string | null> {
  let query = client.database
    .from('social_accounts')
    .select('unipile_account_id, account_id')
    .eq('user_id', userId)
    .eq('platform', 'linkedin')
    .not('unipile_account_id', 'is', null);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data } = await query.limit(1).maybeSingle();

  return liveAccountId(client, data as StoredLinkedInAccount | null, {
    column: 'user_id',
    value: userId,
  });
}

export async function resolveLinkedInProfile(
  accountId: string,
  linkedinIdentifier: string,
): Promise<LinkedInProfile> {
  const identifier = parseLinkedInPublicIdentifier(linkedinIdentifier);
  const res = await unipileJsonGet(
    `/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}`,
  );

  if (!res.ok) {
    throw new Error(`Profile lookup failed: ${await parseUnipileError(res)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const providerId = String(json.provider_id ?? '');
  if (!providerId) {
    throw new Error('LinkedIn profile missing provider_id');
  }

  return {
    providerId,
    publicIdentifier: json.public_identifier ? String(json.public_identifier) : identifier,
    firstName: json.first_name ? String(json.first_name) : undefined,
    lastName: json.last_name ? String(json.last_name) : undefined,
    headline: json.headline ? String(json.headline) : undefined,
  };
}

export async function getInMailBalance(accountId: string): Promise<InMailBalance> {
  const res = await unipileJsonGet(
    `/linkedin/inmail_balance?account_id=${encodeURIComponent(accountId)}`,
  );

  if (!res.ok) {
    return { available: null, raw: { error: await parseUnipileError(res) } };
  }

  const json = (await res.json()) as {
    premium?: number | null;
    recruiter?: number | null;
    sales_navigator?: number | null;
  };
  const api = getLinkedInApiMode();
  const available =
    api === 'sales_navigator'
      ? (json.sales_navigator ?? json.premium ?? null)
      : api === 'recruiter'
        ? (json.recruiter ?? json.premium ?? null)
        : (json.premium ?? null);

  return { available, raw: json };
}

export async function sendLinkedInInMail(
  accountId: string,
  providerId: string,
  text: string,
): Promise<SendResult> {
  const api = getLinkedInApiMode();
  const res = await unipileFormPost('/chats', {
    account_id: accountId,
    text: text.slice(0, 1900),
    attendees_ids: [providerId],
    'linkedin[api]': api,
    'linkedin[inmail]': 'true',
  });

  if (!res.ok) {
    return { success: false, error: await parseUnipileError(res) };
  }

  const json = (await res.json()) as { id?: string; chat_id?: string; object?: string };
  return {
    success: true,
    externalId: json.id ?? json.chat_id ?? json.object,
  };
}

export async function sendLinkedInConnectionInvite(
  accountId: string,
  providerId: string,
  message: string,
): Promise<SendResult> {
  const res = await unipileJsonPost('/users/invite', {
    account_id: accountId,
    provider_id: providerId,
    message: message.slice(0, 300),
  });

  if (!res.ok) {
    return { success: false, error: await parseUnipileError(res) };
  }

  const json = (await res.json()) as { id?: string; invitation_id?: string };
  return {
    success: true,
    externalId: json.id ?? json.invitation_id,
  };
}

/**
 * Follows a LinkedIn profile. Unipile exposes no first-class follow endpoint, so
 * this uses the documented raw-data passthrough (`POST /linkedin`) to the Voyager
 * `followingStates` mutation. `providerId` is the target's internal id (ACoAA…),
 * the same value used in the `fsd_profile` URN.
 *
 * https://developer.unipile.com/docs/get-raw-data-example#following-someone
 */
export async function followLinkedInProfile(
  accountId: string,
  providerId: string,
): Promise<SendResult> {
  const requestUrl =
    'https://www.linkedin.com/voyager/api/feed/dash/followingStates/' +
    `urn:li:fsd_followingState:urn:li:fsd_profile:${providerId}`;

  const res = await unipileJsonPost('/linkedin', {
    account_id: accountId,
    method: 'POST',
    request_url: requestUrl,
    body: { patch: { $set: { following: true } } },
    encoding: false,
  });

  if (!res.ok) {
    return { success: false, error: await parseUnipileError(res) };
  }

  return { success: true, externalId: providerId };
}

export interface LinkedInPersonSearchResult {
  name?: string;
  role?: string;
  linkedinUrl?: string;
}

/** A single item from Unipile's `/linkedin/search` classic people-search response. */
interface UnipileSearchItem {
  type?: string;
  id?: string;
  name?: string;
  profile_url?: string;
  headline?: string;
}

/**
 * Best-effort LinkedIn people-search by name + company, used by the contact
 * ladder's Unipile rung (rung 4): a lead may already have a founder name
 * without a LinkedIn URL, and this is the last deterministic attempt to turn
 * that name into a reachable profile before the lead is marked `no_contact`.
 *
 * Fail-closed by design: a missing `accountId` (no connected LinkedIn account
 * to search from), a non-2xx Unipile response, or a malformed payload all
 * return null rather than throw, so the ladder always degrades cleanly
 * instead of blocking lead resolution on an unavailable lookup. Failures are
 * still surfaced via a debug log (not a silent catch) when SIGNALS_DEBUG is on.
 */
export async function searchLinkedInPerson(query: {
  name: string;
  company: string;
  accountId: string;
  /** Override the default "name company" keyword string (e.g. "CEO Acme Inc"). */
  keywords?: string;
}): Promise<LinkedInPersonSearchResult | null> {
  if (!query.accountId) return null;

  try {
    const api = getLinkedInApiMode();
    const params = new URLSearchParams({ account_id: query.accountId, limit: '10' });
    const res = await unipileJsonPost(`/linkedin/search?${params.toString()}`, {
      api,
      category: 'people',
      keywords: (query.keywords ?? `${query.name} ${query.company}`).trim(),
    });

    if (!res.ok) {
      if (signalsDebugEnabled()) {
        console.warn(`[unipile-search] non-2xx: ${await parseUnipileError(res)}`);
      }
      return null;
    }

    const json = (await res.json()) as { items?: UnipileSearchItem[] } | UnipileSearchItem[];
    const items = Array.isArray(json) ? json : (json.items ?? []);
    // Require an explicit PEOPLE type: a company/post result mapped as a founder
    // contact would corrupt the record. Classic people-search always tags items.
    const found = items.find((item) => item.type === 'PEOPLE');
    if (!found?.profile_url) return null;

    return {
      name: found.name,
      role: found.headline,
      linkedinUrl: found.profile_url,
    };
  } catch (err) {
    // Network/parse failure: never throw into the ladder, just log under debug.
    if (signalsDebugEnabled()) {
      console.warn(`[unipile-search] error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/**
 * First connected LinkedIn Unipile account in the workspace, used to resolve
 * the `account_id` the search endpoint requires when no specific user session
 * is available (mirrors `getWorkspacePollAccount`'s query shape).
 */
export async function getWorkspaceLinkedInAccountId(
  client: InsforgeClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await client.database
    .from('social_accounts')
    .select('unipile_account_id, account_id')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'linkedin')
    .not('unipile_account_id', 'is', null)
    .limit(1)
    .maybeSingle();

  return liveAccountId(client, data as StoredLinkedInAccount | null, {
    column: 'workspace_id',
    value: workspaceId,
  });
}

export async function sendLinkedInDirectMessage(
  accountId: string,
  providerId: string,
  text: string,
): Promise<SendResult> {
  const api = getLinkedInApiMode();
  const res = await unipileFormPost('/chats', {
    account_id: accountId,
    text: text.slice(0, 1900),
    attendees_ids: [providerId],
    'linkedin[api]': api,
  });

  if (!res.ok) {
    return { success: false, error: await parseUnipileError(res) };
  }

  const json = (await res.json()) as { id?: string; chat_id?: string };
  return {
    success: true,
    externalId: json.id ?? json.chat_id,
  };
}

/** Sends a message into an existing LinkedIn chat thread (preferred for replies). */
export async function sendLinkedInChatMessage(
  accountId: string,
  chatId: string,
  text: string,
): Promise<SendResult> {
  const res = await unipileFormPost(`/chats/${encodeURIComponent(chatId)}/messages`, {
    account_id: accountId,
    text: text.slice(0, 1900),
  });

  if (!res.ok) {
    return { success: false, error: await parseUnipileError(res) };
  }

  const json = (await res.json()) as { id?: string; message_id?: string };
  return {
    success: true,
    externalId: json.id ?? json.message_id ?? chatId,
  };
}
