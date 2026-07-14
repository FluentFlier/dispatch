import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { fetchYcCompanyDetail, type YcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import { errorResponse } from '@/lib/api-errors';

// Fetching the YC detail page can take ~1-2s; keep the node runtime.
export const runtime = 'nodejs';

/**
 * GET /api/leads/:id/company
 * Rich company info for the lead card. For YC leads this reads the company's YC
 * detail page (logo, about, team size, location, stage, links); other sources
 * fall back to the stored lead fields so the card always renders something.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // Fallback built from what we already store, used for non-YC leads or if the
    // YC fetch fails - the card never renders empty.
    const fallback: YcCompanyDetail = {
      name: lead.company_name,
      slug: lead.external_id ?? '',
      oneLiner: lead.tagline ?? undefined,
      description: undefined,
      website: lead.website ?? undefined,
      ycUrl: lead.external_id ? `https://www.ycombinator.com/companies/${lead.external_id}` : '',
      logoUrl: undefined,
      batch: lead.batch ?? undefined,
      teamSize: undefined,
      location: undefined,
      yearFounded: undefined,
      status: undefined,
      primaryPartner: undefined,
      linkedinUrl: undefined,
      twitterUrl: undefined,
      industries: lead.tags ?? [],
      photos: [],
      founders: [],
    };

    if (lead.source === 'yc_directory' && lead.external_id) {
      const detail = await fetchYcCompanyDetail(lead.external_id);
      // The YC detail carries every field the card needs; the client fills any
      // gaps from the stored lead. Fall back entirely if the fetch failed.
      if (detail) return NextResponse.json({ company: detail });
    }

    return NextResponse.json({ company: fallback });
  } catch (err) {
    return errorResponse('Could not load company info.', 500, err);
  }
}
