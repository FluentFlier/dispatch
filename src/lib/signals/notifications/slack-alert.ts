import type { createClient } from '@insforge/sdk';
import { sendSlackAlert } from '@/lib/composio/actions/slack';
import { isComposioConfigured } from '@/lib/composio/config';
import { getIntegration } from '@/lib/signals/integrations/store';
import type { SignalEventRow } from '@/lib/signals/types';
import { logSignalAudit } from '@/lib/signals/safety/audit';

type InsforgeClient = ReturnType<typeof createClient>;

export const SIGNAL_LABELS: Record<string, string> = {
  accelerator_join: 'New accelerator signal',
  funding_round: 'New funding signal',
  role_change: 'New role change signal',
  launch: 'New launch signal',
  field_change: 'Profile/company change signal',
  other: 'New signal',
};

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Fire-and-forget Slack alert when a new signal is created */
export async function notifySlackForNewSignal(
  client: InsforgeClient,
  workspaceId: string,
  event: Pick<
    SignalEventRow,
    'id' | 'signal_type' | 'company_name' | 'person_name' | 'batch' | 'signal_summary'
  >,
): Promise<void> {
  if (!isComposioConfigured()) return;

  const integration = await getIntegration(client, workspaceId, 'slack');
  if (!integration?.enabled) return;

  const channelId = integration.config.slack_channel_id;
  if (!channelId || integration.config.notify_on_new_signal === false) return;

  const title = SIGNAL_LABELS[event.signal_type] ?? 'New GTM signal';
  const target = event.company_name || event.person_name;

  const result = await sendSlackAlert(integration.composio_user_id, {
    channelId,
    title,
    summary: event.signal_summary ?? 'Review this signal in Content OS.',
    company: target,
    batch: event.batch,
    signalUrl: `${appBaseUrl()}/signals`,
  });

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: result.success ? 'slack_alert_sent' : 'slack_alert_failed',
    event_id: event.id,
    channel: 'slack',
    blocked_reason: result.error,
    metadata: { channel_id: channelId },
  });
}
