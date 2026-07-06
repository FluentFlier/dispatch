import type { createClient } from '@insforge/sdk';
import {
  getLinkedInUnipileAccountId,
  parseLinkedInPublicIdentifier,
  resolveLinkedInProfile,
} from '@/lib/signals/outreach/unipile-linkedin';
import { unipileJsonGet } from '@/lib/signals/outreach/unipile-client';

type InsforgeClient = ReturnType<typeof createClient>;

function parseFirstDegree(json: Record<string, unknown>): boolean {
  const dist = String(json.network_distance ?? json.distance ?? '').toUpperCase();
  if (dist.includes('FIRST') || dist === 'DISTANCE_1' || dist === '1') return true;
  if (json.is_relationship === true || json.connected === true) return true;
  const rel = json.relationship as { connection?: string } | undefined;
  if (rel?.connection?.toLowerCase() === 'connected') return true;
  return false;
}

/** Returns true when the prospect is a 1st-degree LinkedIn connection. */
export async function isLinkedInFirstDegree(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  linkedinIdentifier: string,
  providerId?: string | null,
): Promise<boolean> {
  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return false;

  const identifier = providerId ?? parseLinkedInPublicIdentifier(linkedinIdentifier);
  try {
    const res = await unipileJsonGet(
      `/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}`,
    );
    if (!res.ok) return false;
    const json = (await res.json()) as Record<string, unknown>;
    return parseFirstDegree(json);
  } catch {
    return false;
  }
}

/** Resolves provider id for connection checks when only URL is known. */
export async function resolveLeadProviderId(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  linkedinUrl: string,
): Promise<string | null> {
  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return null;
  try {
    const profile = await resolveLinkedInProfile(accountId, linkedinUrl);
    return profile.providerId;
  } catch {
    return null;
  }
}
