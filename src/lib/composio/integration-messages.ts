import type { ComposioToolkit } from '@/lib/composio/config';

const TOOLKIT_LABELS: Record<ComposioToolkit, string> = {
  googlecalendar: 'Google Calendar',
  gmail: 'Gmail',
  slack: 'Slack',
};

export interface IntegrationNotice {
  type: 'success' | 'error';
  message: string;
}

function outreachErrorMessage(code: string): string {
  switch (code) {
    case 'invalid_state':
      return 'OAuth session expired. Please try connecting again.';
    case 'wrong_user':
      return 'Connected with a different account. Sign in with the account you started with.';
    case 'wrong_workspace':
      return 'Workspace mismatch during connect. Switch to the correct workspace and retry.';
    case 'connect_failed':
      return 'Connection was declined or failed. Please try again.';
    case 'not_connected':
      return 'Authorization finished but the integration is not active yet. Retry connect.';
    case 'save_failed':
      return 'Connected externally but saving failed. Try again or contact support.';
    default:
      return 'Integration connect failed. Please try again.';
  }
}

function calendarErrorMessage(code: string): string {
  switch (code) {
    case 'composio_not_configured':
      return 'Composio is not configured on this deployment. Add COMPOSIO_API_KEY to hosting secrets.';
    case 'auth_config_missing':
      return 'Google Calendar auth is not configured. Set COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID.';
    case 'connect_failed':
      return 'Could not start Google Calendar connect. Check Composio credentials and retry.';
    default:
      return 'Google Calendar connect failed. Please try again.';
  }
}

/** Maps OAuth redirect query params to a user-visible banner message. */
export function integrationNoticeFromSearchParams(
  params: Pick<URLSearchParams, 'get'>,
): IntegrationNotice | null {
  if (params.get('notion_connected') === 'true') {
    return { type: 'success', message: 'Notion connected. Add the pages you want to use as context, then sync.' };
  }

  const notionError = params.get('notion_error');
  if (notionError) {
    const message = notionError === 'invalid_state'
      ? 'The Notion connection session expired. Please try again.'
      : notionError === 'authorization_declined'
        ? 'Notion authorization was cancelled.'
        : notionError === 'wrong_user' || notionError === 'wrong_workspace'
          ? 'The Notion connection was started from a different account or workspace.'
          : 'Could not connect Notion. Please try again.';
    return { type: 'error', message };
  }

  const outreachConnected = params.get('outreach_connected') as ComposioToolkit | null;
  if (outreachConnected && outreachConnected in TOOLKIT_LABELS) {
    return {
      type: 'success',
      message: `${TOOLKIT_LABELS[outreachConnected]} connected successfully.`,
    };
  }

  const outreachError = params.get('outreach_error');
  if (outreachError) {
    return { type: 'error', message: outreachErrorMessage(outreachError) };
  }

  const calendarError = params.get('calendar_error');
  if (calendarError) {
    return { type: 'error', message: calendarErrorMessage(calendarError) };
  }

  if (params.get('connected') === 'true') {
    return { type: 'success', message: 'Social account connected successfully.' };
  }

  if (params.get('error') === 'unipile_failed') {
    return { type: 'error', message: 'Social connect failed. Please try again.' };
  }

  return null;
}
