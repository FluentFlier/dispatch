import type { createClient } from '@insforge/sdk';
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

export async function getLinkedInUnipileAccountId(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<string | null> {
  let query = client.database
    .from('social_accounts')
    .select('unipile_account_id')
    .eq('user_id', userId)
    .eq('platform', 'linkedin')
    .not('unipile_account_id', 'is', null);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data } = await query.limit(1).maybeSingle();

  return (data?.unipile_account_id as string) ?? null;
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

export interface LinkedInPersonSearchResult {
  name?: string;
  role?: string;
  linkedinUrl?: string;
}

/**
 * Best-effort LinkedIn people-search by name + company, used by the contact
 * ladder's Unipile rung. Unipile's classic search requires a connected LinkedIn
 * account_id, which this module has no workspace context to resolve, and the
 * platform's people-search surface is not yet wired up here. Returns null
 * (never throws) so the ladder always degrades cleanly to `no_contact` instead
 * of blocking lead resolution on an unavailable lookup.
 */
export async function searchLinkedInPerson(_query: {
  name: string;
  company: string;
}): Promise<LinkedInPersonSearchResult | null> {
  return null;
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
