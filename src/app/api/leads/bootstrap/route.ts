import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getDirectorySettings, listFollowedCompanies, listLeads } from '@/lib/signals/leads/store';
import { ensureSeedProfile } from '@/lib/signals/leads/icp-profiles';
import { isLeadsDemoMode } from '@/lib/signals/ingest/config';
import { errorResponse } from '@/lib/api-errors';
import {
  checkLeadsSetup,
  isMissingRelationError,
  setupRequiredResponse,
} from '@/lib/db/setup-gate';
import type { LeadStatus } from '@/lib/signals/types';

/**
 * GET /api/leads/bootstrap
 * Single round-trip for the /leads page: ranked leads, directory settings, and
 * the followed-companies watchlist. Optional ?status filter.
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
    const setup = await checkLeadsSetup(client);
    if (!setup.ok) {
      return setupRequiredResponse(setup.missing, {
        error: 'Leads engine not provisioned — contact support',
        detail: setup.flagDisabled
          ? 'Enable signals_engine (feature_flags) and apply db/signals.sql + db/signals-leads.sql'
          : 'Apply db/signals.sql and db/signals-leads.sql on InsForge',
      });
    }

    const [leads, settings, followedCompanies, profiles] = await Promise.all([
      listLeads(client, workspaceId, { status }),
      getDirectorySettings(client, workspaceId),
      listFollowedCompanies(client, workspaceId),
      ensureSeedProfile(client, workspaceId),
    ]);
    return NextResponse.json({ leads, settings, followedCompanies, profiles, demoData: isLeadsDemoMode() });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return setupRequiredResponse(['signal_leads'], {
        error: 'Leads engine not provisioned — contact support',
        detail: 'Apply db/signals.sql and db/signals-leads.sql on InsForge',
      });
    }
    return errorResponse('Could not load leads.', 500, err);
  }
}
