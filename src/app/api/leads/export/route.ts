import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { listLeads, parseLeadListStatusParam } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

/**
 * Quote a CSV cell, escaping embedded quotes; join arrays with "; ".
 * Neutralizes spreadsheet formula injection: Excel/Sheets execute a cell that
 * begins with =, +, -, @ (or a leading control char) as a formula. Several
 * columns here (company_name, tagline, tags, ...) carry scraped,
 * attacker-influenced text, so prefix those with a single quote to force the
 * cell to render as literal text.
 */
function cell(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (Array.isArray(value)) s = value.join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const COLUMNS: string[] = [
  'company_name', 'domain', 'website', 'batch', 'source', 'tags',
  'hiring', 'raised', 'seeking_investors', 'seeking_tools',
  'fit_score', 'rank_score', 'contact_status', 'lead_status',
  'contact_name', 'contact_role', 'contact_linkedin', 'contact_email', 'contact_source',
  'first_seen_at', 'last_seen_at',
];

/**
 * GET /api/leads/export?status=
 * Streams the workspace's leads as CSV so they can be pulled into a CRM or
 * spreadsheet. Surfaces the rich fields the feed UI hides: intent flags,
 * fit/rank scores, primary-contact details, enrichment source, and timestamps.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const statusParam = request.nextUrl.searchParams.get('status');
  const listFilter = parseLeadListStatusParam(statusParam);

  try {
    const client = getServerClient();
    const leads = await listLeads(client, workspaceId, { ...listFilter, limit: 200 });

    const rows = leads.map((lead) => {
      const intent = (lead.intent_flags ?? {}) as Record<string, boolean>;
      const c = lead.primary_contact;
      return [
        lead.company_name, lead.domain, lead.website, lead.batch, lead.source, lead.tags,
        intent.hiring, intent.raised, intent.seeking_investors, intent.seeking_tools,
        lead.fit_score, lead.rank_score, lead.contact_status, lead.lead_status,
        c?.name, c?.role, c?.linkedin_url, c?.email, c?.resolution_source,
        lead.first_seen_at, lead.last_seen_at,
      ].map(cell).join(',');
    });

    const csv = [COLUMNS.join(','), ...rows].join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse('Could not export leads.', 500, err);
  }
}
