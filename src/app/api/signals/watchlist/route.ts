import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { addWatchlistEntry } from '@/lib/signals/watchlist';
import { errorResponse } from '@/lib/api-errors';

const CreateWatchlistEntrySchema = z
  .object({
    name: z.string().min(1).max(120),
    xHandle: z.string().min(1).max(60).optional(),
    linkedinCompanyUrl: z.string().min(1).max(500).optional(),
    keywords: z.array(z.string().min(1).max(80)).max(50).optional(),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof CreateWatchlistEntrySchema>;
  try {
    body = CreateWatchlistEntrySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const result = await addWatchlistEntry(client, workspaceId, {
      name: body.name.trim(),
      xHandle: body.xHandle,
      linkedinCompanyUrl: body.linkedinCompanyUrl,
      keywords: body.keywords,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse('Could not add watchlist entry.', 500, err);
  }
}
