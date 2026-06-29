import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { sendSignalOutreach } from '@/lib/signals/outreach/send';
import { errorResponse } from '@/lib/api-errors';

const SendSchema = z
  .object({
    channel: z.enum(['linkedin_connect', 'linkedin_dm', 'gmail']),
    linkedin_identifier: z.string().min(2).max(500).optional(),
    recipient_email: z.string().email().optional(),
    email_subject: z.string().min(1).max(200).optional(),
    message_text: z.string().min(1).max(5000).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.channel === 'gmail' && !body.recipient_email) {
      ctx.addIssue({
        code: 'custom',
        message: 'recipient_email is required for Gmail',
        path: ['recipient_email'],
      });
    }
    if (body.channel !== 'gmail' && !body.linkedin_identifier) {
      ctx.addIssue({
        code: 'custom',
        message: 'linkedin_identifier is required for LinkedIn',
        path: ['linkedin_identifier'],
      });
    }
  });

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof SendSchema>;
  try {
    body = SendSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message : 'Invalid request body';
    return NextResponse.json({ error: message ?? 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const result = await sendSignalOutreach(client, {
      workspaceId,
      userId: user.id,
      eventId: params.id,
      channel: body.channel,
      linkedinIdentifier: body.linkedin_identifier?.trim(),
      recipientEmail: body.recipient_email,
      emailSubject: body.email_subject,
      messageText: body.message_text,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error, ...result }, { status: 422 });
    }

    return NextResponse.json({ result, event: result.event ?? null });
  } catch (err) {
    return errorResponse('Could not send outreach.', 500, err);
  }
}
