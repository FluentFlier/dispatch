export type ComposioToolkit = 'slack' | 'gmail' | 'googlecalendar';

export const COMPOSIO_TOOLKIT_SLUGS: Record<ComposioToolkit, string> = {
  slack: 'SLACK',
  gmail: 'GMAIL',
  googlecalendar: 'GOOGLECALENDAR',
};

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

export function getComposioAuthConfigId(toolkit: ComposioToolkit): string | null {
  const envKey = {
    slack: 'COMPOSIO_SLACK_AUTH_CONFIG_ID',
    gmail: 'COMPOSIO_GMAIL_AUTH_CONFIG_ID',
    googlecalendar: 'COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID',
  }[toolkit];
  return process.env[envKey]?.trim() || null;
}

/** True when Composio API key and the toolkit auth config are both set. */
export function isComposioToolkitReady(toolkit: ComposioToolkit): boolean {
  return isComposioConfigured() && Boolean(getComposioAuthConfigId(toolkit));
}

export function composioCallbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/integrations/composio/callback`;
}
