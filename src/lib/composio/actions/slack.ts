import { executeComposioTool } from '@/lib/composio/execute';

export interface SlackAlertPayload {
  channelId: string;
  title: string;
  summary: string;
  signalUrl: string;
  company?: string | null;
  batch?: string | null;
}

export async function sendSlackAlert(
  composioUserId: string,
  payload: SlackAlertPayload,
): Promise<{ success: boolean; error?: string }> {
  const lines = [
    `*${payload.title}*`,
    payload.company ? `*Target:* ${payload.company}${payload.batch ? ` (${payload.batch})` : ''}` : null,
    payload.summary,
    `<${payload.signalUrl}|Review in Content OS Signals →>`,
  ].filter(Boolean);

  const result = await executeComposioTool(composioUserId, 'SLACK_SEND_MESSAGE', {
    channel: payload.channelId,
    markdown_text: lines.join('\n'),
  });

  return result.success
    ? { success: true }
    : { success: false, error: result.error ?? 'Slack send failed' };
}

export interface SlackChannel {
  id: string;
  name: string;
}

/**
 * Lists the public + private channels the connected Slack user can see, so the
 * UI can offer a channel picker (SLACK_SEND_MESSAGE needs the resolved id, not a
 * display name). ponytail: first page only (limit 200) - a workspace with more
 * than 200 channels is rare here and the search box in the dropdown covers the
 * common case; add cursor pagination if that ever bites.
 */
export async function listSlackChannels(
  composioUserId: string,
): Promise<{ success: boolean; channels: SlackChannel[]; error?: string }> {
  const result = await executeComposioTool<{ channels?: Array<{ id?: string; name?: string }> }>(
    composioUserId,
    'SLACK_LIST_ALL_CHANNELS',
    { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 },
  );

  if (!result.success) {
    return { success: false, channels: [], error: result.error ?? 'Could not list Slack channels' };
  }

  const channels = (result.data?.channels ?? [])
    .filter((c): c is { id: string; name: string } => Boolean(c.id && c.name))
    .map((c) => ({ id: c.id, name: c.name }));

  return { success: true, channels };
}
