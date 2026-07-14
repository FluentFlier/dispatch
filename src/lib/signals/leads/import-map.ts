import type { IngestedLead } from '@/lib/signals/types';
import { normalizeDomain } from '@/lib/signals/leads/identity';
import { parseLinkedInProfileUrl } from '@/lib/signals/leads/enrich-contact';

const COMPANY_KEYS = [
  'company_name',
  'company',
  'organization',
  'org',
  'business',
  'company name',
  'account',
  'account name',
];

const CONTACT_KEYS = [
  'name',
  'contact',
  'contact_name',
  'founder',
  'full_name',
  'contact name',
  'first name',
  'person name',
];
const ROLE_KEYS = ['role', 'title', 'contact_role', 'job title', 'position'];
const LINKEDIN_KEYS = [
  'linkedin',
  'linkedin_url',
  'contact_linkedin',
  'linkedin url',
  'person linkedin url',
  'person linkedin',
  'profile',
  'linkedin profile',
];
const EMAIL_KEYS = ['email', 'contact_email', 'e-mail'];
const WEBSITE_KEYS = ['website', 'domain', 'url', 'company website', 'site'];
const TAGLINE_KEYS = ['tagline', 'description', 'notes', 'about'];

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = row[key]?.trim();
    if (v) return v;
  }
  for (const [k, v] of Object.entries(row)) {
    if (!v?.trim()) continue;
    if (keys.some((alias) => k.includes(alias.replace(/ /g, '')) || alias.replace(/ /g, '').includes(k))) {
      return v.trim();
    }
  }
  return undefined;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function linkedInSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function importExternalId(companyName: string, linkedin?: string, email?: string): string {
  if (linkedin) {
    const slug = linkedInSlug(linkedin);
    if (slug) return `import-li-${slug}`;
  }
  // Use the full email (local part + domain) so distinct contacts that share a
  // local part - alex@acme.com vs alex@other.com - don't collide into one lead.
  if (email) return `import-${slugify(email)}`;
  return `import-${slugify(companyName)}`;
}

function combineContactName(row: Record<string, string>, picked?: string): string | undefined {
  const first = row['first name']?.trim();
  const last = row['last name']?.trim();
  if (first && last) return `${first} ${last}`;
  if (picked?.trim()) return picked.trim();
  return first ?? last;
}

/** Maps a spreadsheet row to an IngestedLead (source: manual). */
export function mapImportRowToLead(row: Record<string, string>): IngestedLead | null {
  let companyName = pick(row, COMPANY_KEYS);
  let contactName = combineContactName(row, pick(row, CONTACT_KEYS));
  let linkedinUrl = pick(row, LINKEDIN_KEYS);
  const email = pick(row, EMAIL_KEYS);
  const role = pick(row, ROLE_KEYS);
  let website = pick(row, WEBSITE_KEYS);
  const tagline = pick(row, TAGLINE_KEYS);

  const blob = Object.values(row).join(' ');
  if (!linkedinUrl) linkedinUrl = parseLinkedInProfileUrl(blob) ?? undefined;
  if (website && !website.startsWith('http')) website = `https://${website}`;

  if (!companyName && contactName) companyName = contactName;
  if (!companyName && linkedinUrl) {
    const slug = linkedInSlug(linkedinUrl);
    companyName = slug ? slug.replace(/-/g, ' ') : 'Imported contact';
  }
  if (!companyName && email) {
    const domain = email.split('@')[1];
    companyName = domain?.split('.')[0] ?? 'Imported lead';
  }

  if (!companyName || companyName.length < 2) return null;
  if (!linkedinUrl && !email && !contactName) return null;

  const domain = website ? normalizeDomain(website) : undefined;

  return {
    source: 'manual',
    externalId: importExternalId(companyName, linkedinUrl, email),
    companyName,
    tagline,
    website,
    tags: domain ? [domain] : [],
    founders: [
      {
        name: contactName,
        role,
        linkedinUrl,
        email,
      },
    ],
  };
}

/** Deduplicates mapped leads by externalId. */
export function mapImportRowsToLeads(rows: Record<string, string>[]): IngestedLead[] {
  const seen = new Set<string>();
  const leads: IngestedLead[] = [];
  for (const row of rows) {
    const lead = mapImportRowToLead(row);
    if (!lead) continue;
    if (seen.has(lead.externalId)) continue;
    seen.add(lead.externalId);
    leads.push(lead);
  }
  return leads;
}

export interface ExtractedImportLead {
  company_name?: string;
  website?: string;
  tagline?: string;
  contact_name?: string;
  contact_role?: string;
  linkedin_url?: string;
  email?: string;
}

export function mapExtractedImportLeads(rows: ExtractedImportLead[]): IngestedLead[] {
  return mapImportRowsToLeads(
    rows.map((r) => ({
      company_name: r.company_name ?? '',
      website: r.website ?? '',
      tagline: r.tagline ?? '',
      name: r.contact_name ?? '',
      role: r.contact_role ?? '',
      linkedin: r.linkedin_url ?? '',
      email: r.email ?? '',
    })),
  );
}
