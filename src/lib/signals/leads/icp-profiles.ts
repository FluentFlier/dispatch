import type { createClient } from '@insforge/sdk';
import type { AgendaGoalType, IcpProfileRow } from '@/lib/signals/types';
import { normalizeSources } from '@/lib/signals/leads/agenda';
import { getDirectorySettings, updateDirectorySettings } from '@/lib/signals/leads/store';

type InsforgeClient = ReturnType<typeof createClient>;

function toGoalType(raw: unknown): AgendaGoalType {
  const v = String(raw ?? 'networking');
  return v === 'networking' ||
    v === 'customer_acquisition' ||
    v === 'hiring' ||
    v === 'fundraising' ||
    v === 'other'
    ? v
    : 'networking';
}

function toPositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Normalizes a stored row: jsonb array columns come back as unknown. */
function hydrate(row: Record<string, unknown>): IcpProfileRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    name: String(row.name ?? 'Untitled ICP'),
    description: (row.description as string | null) ?? null,
    verticals: Array.isArray(row.verticals) ? (row.verticals as unknown[]).map(String) : [],
    keywords: Array.isArray(row.keywords) ? (row.keywords as unknown[]).map(String) : [],
    is_active: Boolean(row.is_active),
    goal_type: toGoalType(row.goal_type),
    target_personas: Array.isArray(row.target_personas)
      ? (row.target_personas as unknown[]).map(String)
      : [],
    pitch_angle: (row.pitch_angle as string | null) ?? null,
    tone_rules: (row.tone_rules as string | null) ?? null,
    daily_connect_limit: toPositiveInt(row.daily_connect_limit, 5),
    daily_comment_limit: toPositiveInt(row.daily_comment_limit, 5),
    sources: normalizeSources(row.sources),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

/** Lists a workspace's saved ICP profiles, newest first. */
export async function listIcpProfiles(
  client: InsforgeClient,
  workspaceId: string,
): Promise<IcpProfileRow[]> {
  const { data, error } = await client.database
    .from('signal_icp_profiles')
    .select('*')
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => hydrate(r as Record<string, unknown>))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export interface IcpProfileInput {
  name: string;
  description?: string | null;
  verticals?: string[];
  keywords?: string[];
  goal_type?: AgendaGoalType;
  target_personas?: string[];
  pitch_angle?: string | null;
  tone_rules?: string | null;
  daily_connect_limit?: number;
  daily_comment_limit?: number;
  sources?: string[];
}

/** Builds the agenda columns present in `patch` for insert/update. */
function agendaColumns(patch: Partial<IcpProfileInput>): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (patch.goal_type !== undefined) cols.goal_type = toGoalType(patch.goal_type);
  if (patch.target_personas !== undefined) cols.target_personas = patch.target_personas;
  if (patch.pitch_angle !== undefined) cols.pitch_angle = patch.pitch_angle?.trim() || null;
  if (patch.tone_rules !== undefined) cols.tone_rules = patch.tone_rules?.trim() || null;
  if (patch.daily_connect_limit !== undefined) {
    cols.daily_connect_limit = toPositiveInt(patch.daily_connect_limit, 5);
  }
  if (patch.daily_comment_limit !== undefined) {
    cols.daily_comment_limit = toPositiveInt(patch.daily_comment_limit, 5);
  }
  if (patch.sources !== undefined) cols.sources = normalizeSources(patch.sources);
  return cols;
}

/**
 * Creates a new ICP profile. When `activate` is set (or it's the workspace's
 * first profile) it becomes active and is mirrored into directory settings.
 */
export async function createIcpProfile(
  client: InsforgeClient,
  workspaceId: string,
  input: IcpProfileInput & { activate?: boolean },
): Promise<IcpProfileRow> {
  const existing = await listIcpProfiles(client, workspaceId);
  const makeActive = input.activate || existing.length === 0;

  const { data, error } = await client.database
    .from('signal_icp_profiles')
    .insert([
      {
        workspace_id: workspaceId,
        name: input.name.trim() || 'Untitled ICP',
        description: input.description?.trim() || null,
        verticals: input.verticals ?? [],
        keywords: input.keywords ?? [],
        is_active: false,
        ...agendaColumns(input),
      },
    ])
    .select('*');
  if (error) throw error;
  const created = hydrate((data as Record<string, unknown>[])[0]);

  if (makeActive) return activateIcpProfile(client, workspaceId, created.id);
  return created;
}

/** Patches a profile's fields; re-mirrors settings if the active profile changed. */
export async function updateIcpProfile(
  client: InsforgeClient,
  workspaceId: string,
  id: string,
  patch: Partial<IcpProfileInput>,
): Promise<IcpProfileRow> {
  const next: Record<string, unknown> = { updated_at: new Date().toISOString(), ...agendaColumns(patch) };
  if (patch.name !== undefined) next.name = patch.name.trim() || 'Untitled ICP';
  if (patch.description !== undefined) next.description = patch.description?.trim() || null;
  if (patch.verticals !== undefined) next.verticals = patch.verticals;
  if (patch.keywords !== undefined) next.keywords = patch.keywords;

  const { data, error } = await client.database
    .from('signal_icp_profiles')
    .update(next)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select('*');
  if (error) throw error;
  const rows = (data as Record<string, unknown>[]) ?? [];
  if (rows.length === 0) throw new Error('ICP profile not found');
  const updated = hydrate(rows[0]);

  if (updated.is_active) await mirrorToSettings(client, workspaceId, updated);
  return updated;
}

/**
 * Deletes a profile. If it was active, the newest remaining profile is promoted
 * to active (and mirrored) so a workspace always has a working ICP when it has any.
 */
export async function deleteIcpProfile(
  client: InsforgeClient,
  workspaceId: string,
  id: string,
): Promise<void> {
  const all = await listIcpProfiles(client, workspaceId);
  const target = all.find((p) => p.id === id);

  const { error } = await client.database
    .from('signal_icp_profiles')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (error) throw error;

  if (target?.is_active) {
    const next = all.find((p) => p.id !== id);
    if (next) await activateIcpProfile(client, workspaceId, next.id);
  }
}

/**
 * Makes one profile active (clearing the flag on the rest) and copies its ICP
 * into signal_directory_settings so discovery/scoring/digests use it.
 */
export async function activateIcpProfile(
  client: InsforgeClient,
  workspaceId: string,
  id: string,
): Promise<IcpProfileRow> {
  const nowIso = new Date().toISOString();
  // Clear the flag everywhere first (the partial unique index forbids two actives).
  await client.database
    .from('signal_icp_profiles')
    .update({ is_active: false, updated_at: nowIso })
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  const { data, error } = await client.database
    .from('signal_icp_profiles')
    .update({ is_active: true, updated_at: nowIso })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select('*');
  if (error) throw error;
  const rows = (data as Record<string, unknown>[]) ?? [];
  if (rows.length === 0) throw new Error('ICP profile not found');
  const active = hydrate(rows[0]);

  await mirrorToSettings(client, workspaceId, active);
  return active;
}

/** Copies a profile's ICP fields into the workspace directory settings. */
async function mirrorToSettings(
  client: InsforgeClient,
  workspaceId: string,
  profile: IcpProfileRow,
): Promise<void> {
  await updateDirectorySettings(client, workspaceId, {
    icp_description: profile.description,
    icp_verticals: profile.verticals,
    icp_keywords: profile.keywords,
  });
}

/**
 * Ensures a workspace has at least one ICP profile: on first access, seed a
 * "Default" active profile from whatever ICP already lives in directory settings
 * (so nothing is lost when the multi-ICP feature ships). Returns the full list.
 */
export async function ensureSeedProfile(
  client: InsforgeClient,
  workspaceId: string,
): Promise<IcpProfileRow[]> {
  const existing = await listIcpProfiles(client, workspaceId);
  if (existing.length > 0) return existing;

  const settings = await getDirectorySettings(client, workspaceId);
  const hasIcp = Boolean(
    settings.icp_description?.trim() ||
      settings.icp_verticals.length > 0 ||
      settings.icp_keywords.length > 0,
  );
  if (!hasIcp) return [];

  const seeded = await createIcpProfile(client, workspaceId, {
    name: 'Default',
    description: settings.icp_description,
    verticals: settings.icp_verticals,
    keywords: settings.icp_keywords,
    activate: true,
  });
  return [seeded];
}

/**
 * Returns the workspace's active ICP profile, or null when none is active.
 * The nurture engine resolves this into an `Agenda` to pick the outreach angle.
 */
export async function getActiveIcpProfile(
  client: InsforgeClient,
  workspaceId: string,
): Promise<IcpProfileRow | null> {
  const { data, error } = await client.database
    .from('signal_icp_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? hydrate(data as Record<string, unknown>) : null;
}
