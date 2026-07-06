import { describe, expect, it } from 'vitest';
import { checkComposioConfig } from '@/lib/composio/health';

describe('composio health', () => {
  it('reports missing when COMPOSIO_API_KEY unset', () => {
    const prev = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    const report = checkComposioConfig();
    expect(report.status).toBe('missing');
    expect(report.api_key).toBe('missing');
    if (prev) process.env.COMPOSIO_API_KEY = prev;
  });

  it('reports ok when api key and auth configs present', () => {
    process.env.COMPOSIO_API_KEY = 'test-key';
    process.env.COMPOSIO_STATE_SECRET = 'state-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
    process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID = 'ac_gmail';
    process.env.COMPOSIO_SLACK_AUTH_CONFIG_ID = 'ac_slack';
    process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID = 'ac_cal';

    const report = checkComposioConfig();
    expect(report.status).toBe('ok');
    expect(report.auth_configs.gmail).toBe('ok');
    expect(report.callback_url).toContain('/api/integrations/composio/callback');
  });
});
