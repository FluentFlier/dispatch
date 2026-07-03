import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { addFollowedCompany, listFollowedCompanies } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

/** GET /api/leads/followed — the workspace watchlist. */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const followedCompanies = await listFollowedCompanies(client, workspaceId);
    return NextResponse.json({ followedCompanies });
  } catch (err) {
    return errorResponse('Could not load watchlist.', 500, err);
  }
}

/** POST /api/leads/followed — follow a company (idempotent on domain/name). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as {
    companyName?: string;
    domain?: string;
    externalId?: string;
  };
  if (!body.companyName?.trim() && !body.domain?.trim()) {
    return NextResponse.json({ error: 'Company name or domain required.' }, { status: 422 });
  }

  try {
    const client = getServerClient();
    const res = await addFollowedCompany(client, workspaceId, {
      companyName: body.companyName?.trim() || body.domain!.trim(),
      domain: body.domain?.trim() || null,
      externalId: body.externalId ?? null,
      userId: user.id,
    });
    if (res.duplicate) return NextResponse.json({ duplicate: true }, { status: 200 });
    const followedCompanies = await listFollowedCompanies(client, workspaceId);
    return NextResponse.json({ followedCompanies });
  } catch (err) {
    return errorResponse('Could not follow company.', 500, err);
  }
}
