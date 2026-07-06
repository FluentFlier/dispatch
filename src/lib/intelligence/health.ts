import { loadHookDataset, getBestHooksForContext } from '@/lib/hooks-intelligence';
import { isLlmConfigured } from '@/lib/llm';
import { isComposioConfigured } from '@/lib/composio/config';
import { getSocialProviderMode } from '@/lib/env';
import { buildLoopHealthMetrics, type LoopHealthMetrics } from '@/lib/intelligence/loop-health';

export type HealthStatus = 'ok' | 'degraded' | 'missing' | 'unknown';

export interface SubsystemHealth {
  status: HealthStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface IntelligenceHealthReport {
  status: HealthStatus;
  timestamp: string;
  voice: SubsystemHealth;
  hooks: SubsystemHealth;
  socialListening: SubsystemHealth;
  database: SubsystemHealth;
  loop: LoopHealthMetrics;
  env: Record<string, HealthStatus>;
  actions: string[];
}

function envOk(key: string): HealthStatus {
  return process.env[key]?.trim() ? 'ok' : 'missing';
}

/**
 * Probes voice stack: LLM, humanizer, pipeline modules, optional Supermemory/Gmail.
 */
export function checkVoiceStack(): SubsystemHealth {
  const llmOk = isLlmConfigured();
  const hfOk = Boolean(process.env.HUGGINGFACE_API_KEY?.trim());
  const composioGmail = isComposioConfigured() && Boolean(process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID?.trim());
  const unipileOk = Boolean(process.env.UNIPILE_API_KEY?.trim() && process.env.UNIPILE_DSN?.trim());

  if (!llmOk) {
    return {
      status: 'missing',
      message: 'Set HUGGINGFACE_API_KEY (HF router) or LLM_BASE_URL + LLM_API_KEY for generation.',
      details: { huggingface_scoring: hfOk ? 'ok' : 'missing', unipile_voice_import: unipileOk ? 'ok' : 'missing' },
    };
  }

  const degraded = !hfOk || (!unipileOk && !composioGmail);
  return {
    status: degraded ? 'degraded' : 'ok',
    message: degraded
      ? 'Voice pipeline ready; add HUGGINGFACE_API_KEY for AI scoring and connect Unipile/Gmail for richer voice.'
      : '4-stage pipeline ready (base → hooks → humanize → voice → evaluate).',
    details: {
      pipeline_stages: ['base', 'hooks', 'humanize', 'voice', 'evaluate'],
      humanizer_passes: ['pre_clean', 'clean', 'audit', 'voice'],
      huggingface_scoring: hfOk ? 'ok' : 'missing',
      unipile_posts: unipileOk ? 'ok' : 'missing',
      gmail_email_voice: composioGmail ? 'ok' : 'missing',
    },
  };
}

/**
 * Probes hook intelligence: bundled dataset, Apify prod mining, API route.
 */
export function checkHooksStack(): SubsystemHealth {
  let hookCount = 0;
  try {
    hookCount = loadHookDataset().hooks.length;
  } catch {
    hookCount = 0;
  }

  const sample = getBestHooksForContext(undefined, 3);
  const apifyOk = Boolean(process.env.APIFY_TOKEN?.trim());
  const useApify = process.env.USE_APIFY === 'true' || process.env.NODE_ENV === 'production';

  if (hookCount < 100) {
    return {
      status: 'missing',
      message: 'Hook dataset not loaded — generation hooks will be empty.',
      details: { hook_count: hookCount },
    };
  }

  const degraded = !apifyOk || !useApify;
  return {
    status: degraded ? 'degraded' : 'ok',
    message: degraded
      ? `${hookCount} bootstrap hooks loaded; set APIFY_TOKEN + USE_APIFY=true for live mining.`
      : `${hookCount} hooks ready; Apify prod mining enabled.`,
    details: {
      hook_count: hookCount,
      sample_hooks: sample.map((h) => h.text.slice(0, 80)),
      apify_token: apifyOk ? 'ok' : 'missing',
      use_apify: useApify,
      api_route: '/api/hooks/intelligence',
    },
  };
}

/**
 * Probes social listening: Signals engine (Unipile/Apify/webhook) + directory leads.
 */
export function checkSocialListeningStack(): SubsystemHealth {
  const unipileOk = Boolean(process.env.UNIPILE_API_KEY?.trim() && process.env.UNIPILE_DSN?.trim());
  const signalsApify = process.env.SIGNALS_USE_APIFY === 'true' && Boolean(process.env.APIFY_TOKEN?.trim());
  const tinyfishOk = Boolean(process.env.TINYFISH_API_KEY?.trim());
  const cronOk = Boolean(process.env.CRON_SECRET?.trim());
  const mode = process.env.SIGNALS_INGEST_MODE ?? 'auto';

  const hasIngest =
    unipileOk ||
    signalsApify ||
    mode === 'webhook' ||
    Boolean(process.env.SIGNALS_INGEST_SECRET?.trim());

  if (!hasIngest) {
    return {
      status: 'missing',
      message: 'No social ingest path — connect Unipile or set SIGNALS_USE_APIFY + APIFY_TOKEN.',
      details: { ingest_mode: mode, provider: getSocialProviderMode() },
    };
  }

  const degraded = !cronOk || (!tinyfishOk && !signalsApify);
  return {
    status: degraded ? 'degraded' : 'ok',
    message: degraded
      ? 'Signals ingest configured; add CRON_SECRET for crons and TINYFISH_API_KEY for directory leads.'
      : 'Social listening ready (signals sync + optional directory scrape).',
    details: {
      ingest_mode: mode,
      unipile: unipileOk ? 'ok' : 'missing',
      signals_apify: signalsApify ? 'ok' : 'off',
      tinyfish_leads: tinyfishOk ? 'ok' : 'missing',
      cron: cronOk ? 'ok' : 'missing',
      crons: ['/api/cron/signals-sync', '/api/cron/engagement-sync', '/api/cron/intelligence-sync'],
    },
  };
}

/**
 * Optional DB table probes when service client is available.
 */
export async function checkDatabaseTables(client: unknown): Promise<SubsystemHealth> {
  if (!client || typeof client !== 'object' || !('database' in client)) {
    return {
      status: 'unknown',
      message: 'Database probe skipped (no service client). Run: bash scripts/apply-intelligence-backend.sh',
    };
  }

  const db = client as {
    database: {
      from: (table: string) => {
        select: (col: string) => { limit: (n: number) => Promise<{ error: unknown | null }> };
      };
    };
  };

  const tables = ['hook_performance', 'workspace_voice_metrics', 'hook_examples', 'social_listening_runs'];
  const missing: string[] = [];

  for (const table of tables) {
    try {
      const col = table === 'hook_performance' ? 'hook_id' : 'id';
      const { error } = await db.database.from(table).select(col).limit(1);
      if (error) missing.push(table);
    } catch {
      missing.push(table);
    }
  }

  if (missing.length === tables.length) {
    return {
      status: 'missing',
      message: 'Intelligence tables not migrated. Run scripts/apply-intelligence-backend.sh',
      details: { missing_tables: missing },
    };
  }

  if (missing.length > 0) {
    return {
      status: 'degraded',
      message: `Some intelligence tables missing: ${missing.join(', ')}`,
      details: { missing_tables: missing },
    };
  }

  return { status: 'ok', message: 'Intelligence DB tables present.' };
}

/**
 * Builds a full intelligence health report for API + CLI tooling.
 */
export async function buildIntelligenceHealthReport(
  dbClient?: unknown,
): Promise<IntelligenceHealthReport> {
  const voice = checkVoiceStack();
  const hooks = checkHooksStack();
  const socialListening = checkSocialListeningStack();
  const database = await checkDatabaseTables(dbClient ?? null);
  const loop = await buildLoopHealthMetrics(
    dbClient && typeof dbClient === 'object' && 'database' in dbClient
      ? (dbClient as Parameters<typeof buildLoopHealthMetrics>[0])
      : null,
  );

  const env: Record<string, HealthStatus> = {
    LLM_BASE_URL: envOk('LLM_BASE_URL'),
    LLM_API_KEY: envOk('LLM_API_KEY'),
    HUGGINGFACE_API_KEY: envOk('HUGGINGFACE_API_KEY'),
    UNIPILE_API_KEY: envOk('UNIPILE_API_KEY'),
    APIFY_TOKEN: envOk('APIFY_TOKEN'),
    CRON_SECRET: envOk('CRON_SECRET'),
    TINYFISH_API_KEY: envOk('TINYFISH_API_KEY'),
    COMPOSIO_API_KEY: envOk('COMPOSIO_API_KEY'),
  };

  const actions: string[] = [];
  if (voice.status !== 'ok') actions.push('Set LLM_* env vars for voice generation');
  if (hooks.status !== 'ok') actions.push('Run npm run hooks:research or enable USE_APIFY=true');
  if (socialListening.status !== 'ok') actions.push('Connect Unipile accounts or enable signals Apify fallback');
  if (database.status === 'missing') actions.push('npx @insforge/cli login && bash scripts/apply-all-intelligence.sh');
  actions.push(...loop.recommendations);

  const statuses = [voice.status, hooks.status, socialListening.status, database.status];
  const overall: HealthStatus =
    loop.flywheelStatus === 'closed' && !statuses.includes('missing')
      ? 'ok'
      : statuses.includes('missing')
        ? 'missing'
        : statuses.includes('degraded') || statuses.includes('unknown') || loop.flywheelStatus === 'open'
          ? 'degraded'
          : 'ok';

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    voice,
    hooks,
    socialListening,
    database,
    loop,
    env,
    actions,
  };
}
