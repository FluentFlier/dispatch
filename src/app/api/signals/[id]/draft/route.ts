import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getEvent } from '@/lib/signals/store';
import { draftOutreachForEvent } from '@/lib/signals/outreach/draft';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import type { OutreachChannel } from '@/lib/signals/types';

const DraftSchema = z.object({
  channel: z.enum(['linkedin_connect', 'linkedin_dm', 'x_dm', 'copy', 'gmail']).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let channel: OutreachChannel = 'copy';
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = DraftSchema.parse(raw);
    if (parsed.channel) channel = parsed.channel;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const event = await getEvent(client, workspaceId, params.id);
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const draft = await draftOutreachForEvent(client, user.id, workspaceId, event, channel);
    return NextResponse.json({ draft, event: draft.event });
  } catch (err) {
    return errorResponse('Could not generate draft.', 500, err);
  }
}
