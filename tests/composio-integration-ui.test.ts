import { describe, expect, it } from 'vitest';
import { integrationNoticeFromSearchParams } from '@/lib/composio/integration-messages';
import { isComposioToolkitReady } from '@/lib/composio/config';

describe('integration messages', () => {
  it('maps outreach_connected to success copy', () => {
    const params = new URLSearchParams('outreach_connected=googlecalendar');
    expect(integrationNoticeFromSearchParams(params)?.message).toContain('Google Calendar');
  });

  it('maps calendar_error to error copy', () => {
    const params = new URLSearchParams('calendar_error=auth_config_missing');
    expect(integrationNoticeFromSearchParams(params)?.type).toBe('error');
  });
});

describe('isComposioToolkitReady', () => {
  it('requires api key and auth config', () => {
    const prevKey = process.env.COMPOSIO_API_KEY;
    const prevCal = process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID;
    process.env.COMPOSIO_API_KEY = 'test-key';
    delete process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID;
    expect(isComposioToolkitReady('googlecalendar')).toBe(false);
    process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID = 'cfg-1';
    expect(isComposioToolkitReady('googlecalendar')).toBe(true);
    process.env.COMPOSIO_API_KEY = prevKey;
    if (prevCal) process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID = prevCal;
    else delete process.env.COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID;
  });
});
