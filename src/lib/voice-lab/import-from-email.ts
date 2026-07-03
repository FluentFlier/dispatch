import type { createClient } from '@insforge/sdk';
import { fetchSentEmailsForVoice } from '@/lib/composio/actions/gmail-read';
import { isComposioToolkitConnected } from '@/lib/composio/connect';
import { getIntegration } from '@/lib/signals/integrations/store';

type InsforgeClient = ReturnType<typeof createClient>;

export interface EmailVoiceSample {
  content: string;
  platform: string;
  subject?: string;
}

/**
 * Imports sent-email voice samples when Gmail is connected via Composio.
 * Email voice captures how someone writes 1:1 — often richer than public posts.
 */
export async function importVoiceSamplesFromEmail(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  maxEmails = 30,
): Promise<EmailVoiceSample[]> {
  const integration = await getIntegration(client, workspaceId, 'gmail');
  if (!integration?.enabled) return [];

  const connected = await isComposioToolkitConnected(integration.composio_user_id, 'gmail');
  if (!connected) return [];

  const messages = await fetchSentEmailsForVoice(integration.composio_user_id, maxEmails);

  return messages.map((m) => ({
    content: m.subject ? `${m.subject}\n\n${m.body}` : m.body,
    platform: 'Email',
    subject: m.subject || undefined,
  }));
}
