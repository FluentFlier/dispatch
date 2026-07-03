import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { listLeads } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';
import type { LeadStatus } from '@/lib/signals/types';

/**
 * GET /api/leads?status=new
 * Filter refetch for the Today list (does not reload settings/watchlist).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const statusParam = request.nextUrl.searchParams.get('status');
  const status = statusParam && statusParam !== 'all' ? (statusParam as LeadStatus) : undefined;

  try {
    const client = getServerClient();
    const leads = await listLeads(client, workspaceId, { status });
    return NextResponse.json({ leads });
  } catch (err) {
    return errorResponse('Could not list leads.', 500, err);
  }
}
