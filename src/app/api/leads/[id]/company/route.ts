import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead, updateLead } from '@/lib/signals/leads/store';
import {
  descriptionCheckDue,
  resolveLeadDescription,
  seededLeadDescription,
} from '@/lib/signals/leads/describe';
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
  request: NextRequest,
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

    const cd = lead.company_detail;
    // Use the description we already have before anything else: the scraped
    // company_detail, then the tagline, then the tagline stashed in source_fact.
    const seededDescription = seededLeadDescription(lead);

    // Fallback built from what we already store, used for non-YC leads or if the
    // YC fetch fails - the card never renders empty.
    const fallback: YcCompanyDetail = {
      name: lead.company_name,
      slug: lead.external_id ?? '',
      oneLiner: lead.tagline ?? undefined,
      description: seededDescription,
      website: lead.website ?? undefined,
      // Only real YC leads get a YC link. external_id is set for every source
      // (product_hunt slug, etc.), so templating a YC URL from it unconditionally
      // slapped a bogus "View on YC" link on non-YC leads.
      ycUrl:
        lead.source === 'yc_directory' && lead.external_id
          ? `https://www.ycombinator.com/companies/${lead.external_id}`
          : '',
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

    // Still nothing to show and a lookup is due (never tried, TTL expired, or
    // the user forced a recheck with ?refresh=1): fetch a description from the
    // company's LinkedIn About, then a Google summary (grounded, never
    // invented). A genuine miss is cached with a timestamp and rechecked after
    // the TTL, not latched forever. A timeout/error returns `retry` and
    // persists nothing, so a slow success isn't written off.
    const force = request.nextUrl.searchParams.get('refresh') === '1';
    if (!fallback.description && lead.source !== 'yc_directory' && (force || descriptionCheckDue(cd))) {
      const result = await resolveLeadDescription(lead);
      if (result.status === 'found') {
        fallback.description = result.text;
        await updateLead(client, workspaceId, params.id, {
          company_detail: { ...(cd ?? {}), description: result.text, description_source: result.source },
        });
      } else if (result.status === 'none') {
        await updateLead(client, workspaceId, params.id, {
          company_detail: { ...(cd ?? {}), description_checked_at: new Date().toISOString() },
        });
      }
    }

    return NextResponse.json({ company: fallback });
  } catch (err) {
    return errorResponse('Could not load company info.', 500, err);
  }
}
