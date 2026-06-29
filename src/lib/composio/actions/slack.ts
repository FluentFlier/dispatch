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
