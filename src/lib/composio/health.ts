import {
  composioCallbackUrl,
  getComposioAuthConfigId,
  isComposioConfigured,
  type ComposioToolkit,
} from '@/lib/composio/config';
import { getComposioClient } from '@/lib/composio/client';

export type ComposioHealthStatus = 'ok' | 'degraded' | 'missing';

const TOOLKITS: ComposioToolkit[] = ['slack', 'gmail', 'googlecalendar'];

function hasOAuthStateSecret(): boolean {
  return Boolean(
    process.env.COMPOSIO_STATE_SECRET?.trim() ||
      process.env.CRON_SECRET?.trim() ||
      process.env.TOKEN_ENCRYPTION_KEY?.trim(),
  );
}

/**
 * Static config probe - safe for /api/health without live Composio calls.
 */
export function checkComposioConfig(): {
  status: ComposioHealthStatus;
  api_key: 'ok' | 'missing';
  oauth_state_secret: 'ok' | 'missing';
  app_url: 'ok' | 'missing';
  auth_configs: Record<ComposioToolkit, 'ok' | 'missing'>;
  callback_url: string;
  message: string;
} {
  const apiKeyOk = isComposioConfigured();
  const stateOk = hasOAuthStateSecret();
  const appUrlOk = Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim());

  const authConfigs = Object.fromEntries(
    TOOLKITS.map((toolkit) => [toolkit, getComposioAuthConfigId(toolkit) ? 'ok' : 'missing']),
  ) as Record<ComposioToolkit, 'ok' | 'missing'>;

  const configuredToolkits = TOOLKITS.filter((t) => authConfigs[t] === 'ok');

  let status: ComposioHealthStatus = 'ok';
  let message = 'Composio ready for OAuth connect + tool execution.';

  if (!apiKeyOk) {
    status = 'missing';
    message = 'Set COMPOSIO_API_KEY to enable Gmail, Slack, and Calendar integrations.';
  } else if (!stateOk || !appUrlOk) {
    status = 'degraded';
    message = 'Composio API key set; add COMPOSIO_STATE_SECRET (or CRON_SECRET) and NEXT_PUBLIC_APP_URL for OAuth callbacks.';
  } else if (configuredToolkits.length === 0) {
    status = 'degraded';
    message =
      'Composio API key set; add COMPOSIO_GMAIL_AUTH_CONFIG_ID, COMPOSIO_SLACK_AUTH_CONFIG_ID, and/or COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID.';
  } else if (configuredToolkits.length < TOOLKITS.length) {
    status = 'degraded';
    message = `Composio partially configured (${configuredToolkits.join(', ')} auth configs present).`;
  }

  return {
    status,
    api_key: apiKeyOk ? 'ok' : 'missing',
    oauth_state_secret: stateOk ? 'ok' : 'missing',
    app_url: appUrlOk ? 'ok' : 'missing',
    auth_configs: authConfigs,
    callback_url: composioCallbackUrl(),
    message,
  };
}

/**
 * Live API ping - validates COMPOSIO_API_KEY against Composio backend.
 */
export async function pingComposioApi(): Promise<'ok' | 'error' | 'skipped'> {
  const composio = getComposioClient();
  if (!composio) return 'skipped';

  try {
    await composio.connectedAccounts.list({ limit: 1 });
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function buildComposioHealthReport(opts?: { live?: boolean }) {
  const config = checkComposioConfig();
  const api = opts?.live ? await pingComposioApi() : ('skipped' as const);

  const status: ComposioHealthStatus =
    config.status === 'missing'
      ? 'missing'
      : api === 'error'
        ? 'degraded'
        : config.status;

  return {
    status,
    timestamp: new Date().toISOString(),
    config,
    api,
    connect_routes: {
      gmail: '/api/integrations/composio/link?toolkit=gmail',
      slack: '/api/integrations/composio/link?toolkit=slack',
      googlecalendar: '/api/integrations/composio/connect',
    },
  };
}
