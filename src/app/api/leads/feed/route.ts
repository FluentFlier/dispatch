import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { buildUnifiedFeed, type FeedFilters } from '@/lib/signals/feed/store';
import { errorResponse } from '@/lib/api-errors';
import {
  checkLeadsSetup,
  isMissingRelationError,
  setupRequiredResponse,
} from '@/lib/db/setup-gate';

/**
 * GET /api/leads/feed?status=&source=&kind=&signalType=&limit=
 * Unified Signals + Directory lead feed for the active workspace: both
 * sources are normalized into one card shape, merged, and score-sorted.
 * Query params are optional filters applied after the merge. `limit` is
 * parsed here and clamped to [1, 300] by `buildUnifiedFeed`; an unparsable
 * value is ignored and the feed's default page size is used instead.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const sp = request.nextUrl.searchParams;
  const rawLimit = sp.get('limit');
  const parsedLimit = rawLimit === null ? NaN : parseInt(rawLimit, 10);
  const filters: FeedFilters = {
    status: sp.get('status') ?? undefined,
    source: sp.get('source') ?? undefined,
    kind: (sp.get('kind') as FeedFilters['kind']) ?? undefined,
    signalType: sp.get('signalType') ?? undefined,
    limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit,
  };

  try {
    const client = getServerClient();
    const setup = await checkLeadsSetup(client);
    if (!setup.ok) {
      return setupRequiredResponse(setup.missing, {
        error: 'Leads engine not provisioned - contact support',
        detail: setup.flagDisabled
          ? 'Enable signals_engine (feature_flags) and apply db/signals.sql + db/signals-leads.sql'
          : 'Apply db/signals.sql and db/signals-leads.sql on InsForge',
      });
    }

    const cards = await buildUnifiedFeed(client, workspaceId, filters);
    return NextResponse.json({ cards });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return setupRequiredResponse(['signal_leads', 'signal_events'], {
        error: 'Leads engine not provisioned - contact support',
        detail: 'Apply db/signals.sql and db/signals-leads.sql on InsForge',
      });
    }
    return errorResponse('Could not load feed.', 500, err);
  }
}
