import { executeComposioTool } from '@/lib/composio/execute';

export interface GmailSendInput {
  to: string;
  subject: string;
  body: string;
}

export async function sendGmailEmail(
  composioUserId: string,
  input: GmailSendInput,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const result = await executeComposioTool<{ id?: string }>(composioUserId, 'GMAIL_SEND_EMAIL', {
    recipient_email: input.to,
    subject: input.subject,
    body: input.body,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    messageId: typeof result.data === 'object' && result.data?.id ? result.data.id : undefined,
  };
}
