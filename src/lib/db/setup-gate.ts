import { NextResponse } from 'next/server';
import type { createClient } from '@insforge/sdk';
import { isEnabled } from '@/lib/feature-flags';

type InsforgeClient = ReturnType<typeof createClient>;

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code: unknown }).code ?? '');
  }
  return '';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message ?? '');
  }
  return String(err);
}

/**
 * Detects PostgREST / Postgres "relation missing" failures so routes can soft-fail
 * with a setup gate instead of a cryptic 500.
 */
export function isMissingRelationError(err: unknown): boolean {
  if (!err) return false;

  const code = errorCode(err);
  const message = errorMessage(err);

  // Column-missing errors (42703 / PGRST204) often mention "schema cache" too -
  // those belong to isSchemaMismatchError, not missing-relation.
  if (isSchemaMismatchError(err)) return false;

  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    /could not find the table/i.test(message) ||
    /schema cache/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /does not exist/i.test(message)
  );
}

/**
 * Detects missing-column / wrong-shape schema errors (e.g. Ada's user_settings
 * colliding with Content OS expectations).
 */
export function isSchemaMismatchError(err: unknown): boolean {
  if (!err) return false;

  const code = errorCode(err);
  const message = errorMessage(err);

  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist/i.test(message) ||
    /Could not find the .* column/i.test(message)
  );
}

export interface SetupRequiredPayload {
  setupRequired: true;
  missing: string[];
  error: string;
  /** Operator hint - safe to show in admin / logs; UI may soften for end users. */
  detail?: string;
}

export function setupRequiredResponse(
  missing: string[],
  opts: { error: string; detail?: string; status?: number } = {
    error: 'This feature is not provisioned yet.',
  },
): NextResponse {
  const body: SetupRequiredPayload = {
    setupRequired: true,
    missing,
    error: opts.error,
    ...(opts.detail ? { detail: opts.detail } : {}),
  };
  return NextResponse.json(body, { status: opts.status ?? 503 });
}

/**
 * Probes whether a table is queryable. Returns true when the relation is missing.
 * Does not treat wrong-shape (missing column) as missing - use probeTableUnusable.
 */
export async function isTableMissing(
  client: InsforgeClient,
  table: string,
  selectCol = 'id',
): Promise<boolean> {
  try {
    const { error } = await client.database.from(table).select(selectCol).limit(1);
    return Boolean(error && isMissingRelationError(error));
  } catch (err) {
    return isMissingRelationError(err);
  }
}

/**
 * True when the table is absent OR the expected column is missing (wrong schema).
 */
export async function isTableUnusable(
  client: InsforgeClient,
  table: string,
  selectCol = 'id',
): Promise<boolean> {
  try {
    const { error } = await client.database.from(table).select(selectCol).limit(1);
    if (!error) return false;
    return isMissingRelationError(error) || isSchemaMismatchError(error);
  } catch (err) {
    return isMissingRelationError(err) || isSchemaMismatchError(err);
  }
}

const CORE_SCHEMA_TABLES: { table: string; selectCol: string }[] = [
  { table: 'posts', selectCol: 'id' },
  { table: 'creator_profile', selectCol: 'id' },
  { table: 'social_accounts', selectCol: 'id' },
  { table: 'workspaces', selectCol: 'id' },
  { table: 'publish_jobs', selectCol: 'id' },
  // Ada/tryada may ship a colliding user_settings without Content OS `key`.
  { table: 'user_settings', selectCol: 'key' },
];

/**
 * Content OS core schema readiness. Missing tables or wrong-shape collisions
 * (e.g. user_settings without `key`) are reported in `missing`.
 */
export async function checkCoreSchemaSetup(client: InsforgeClient): Promise<{
  ok: boolean;
  missing: string[];
}> {
  const missing: string[] = [];

  for (const { table, selectCol } of CORE_SCHEMA_TABLES) {
    if (await isTableUnusable(client, table, selectCol)) {
      missing.push(table);
    }
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Leads / signals readiness: missing core tables or disabled signals_engine flag.
 */
export async function checkLeadsSetup(client: InsforgeClient): Promise<{
  ok: boolean;
  missing: string[];
  flagDisabled: boolean;
}> {
  const missing: string[] = [];

  if (await isTableMissing(client, 'signal_leads')) missing.push('signal_leads');
  if (await isTableMissing(client, 'signal_events')) missing.push('signal_events');
  if (await isTableMissing(client, 'feature_flags', 'name')) missing.push('feature_flags');

  const flagDisabled =
    missing.includes('feature_flags')
      ? true
      : !(await isEnabled(client, 'signals_engine'));

  if (flagDisabled && !missing.includes('signals_engine')) {
    missing.push('signals_engine');
  }

  return {
    ok: missing.filter((m) => m !== 'signals_engine').length === 0 && !flagDisabled,
    missing,
    flagDisabled,
  };
}

/**
 * Event capture readiness: table present + Composio calendar path configured.
 */
export async function checkEventCaptureSetup(
  client: InsforgeClient,
  composioConfigured: boolean,
): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  if (await isTableMissing(client, 'event_captures')) missing.push('event_captures');
  if (!composioConfigured) missing.push('composio');
  return { ok: missing.length === 0, missing };
}
