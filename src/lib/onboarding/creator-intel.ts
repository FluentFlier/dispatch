import { generateContent } from '@/lib/ai';
import { serperSearch, jinaRead } from '@/lib/event-capture/research';
import { parseLinkedInPublicIdentifier } from '@/lib/signals/outreach/unipile-linkedin';
import { unipoleFetch } from '@/lib/social/unipile';
import type { OnboardingPlatform } from '@/lib/onboarding/import-posts';

const MAX_WEB_URLS = 3;
const MAX_WEB_CHARS = 12_000;

export interface CreatorExperience {
  title?: string;
  company?: string;
  description?: string;
  dateRange?: string;
}

export interface CreatorEducation {
  school?: string;
  degree?: string;
  field?: string;
}

export interface CreatorLinkedInIntel {
  platform: 'linkedin';
  providerId?: string;
  publicIdentifier?: string;
  profileUrl?: string;
  fullName?: string;
  headline?: string;
  summary?: string;
  location?: string;
  industry?: string;
  followerCount?: number;
  connectionCount?: number;
  experiences: CreatorExperience[];
  education: CreatorEducation[];
  skills: string[];
  websites: string[];
  rawFields: string[];
}

export interface CreatorTwitterIntel {
  platform: 'twitter';
  handle?: string;
  fullName?: string;
  bio?: string;
  location?: string;
  followerCount?: number;
  profileUrl?: string;
}

export interface CreatorWebIntel {
  queries: string[];
  sources: string[];
  bioSummary: string;
  expertise: string[];
  companies: string[];
  topics: string[];
  audience?: string;
  proofPoints: string[];
  notableWork: string[];
  personalAngle?: string;
}

export interface CreatorIntelBundle {
  linkedin: CreatorLinkedInIntel | null;
  twitter: CreatorTwitterIntel | null;
  web: CreatorWebIntel | null;
  bioFacts: string;
}

interface SocialAccountRow {
  platform: OnboardingPlatform;
  unipile_account_id: string;
  account_id: string | null;
  account_name: string | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseStringList(value: unknown, cap = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        return asString(row.name ?? row.title ?? row.skill) ?? '';
      }
      return '';
    })
    .filter((s): s is string => Boolean(s))
    .slice(0, cap);
}

function parseExperiences(value: unknown): CreatorExperience[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      const start = asString(row.start ?? row.starts_at);
      const end = asString(row.end ?? row.ends_at);
      const dateRange = [start, end].filter(Boolean).join(' – ') || undefined;
      return {
        title: asString(row.title ?? row.position ?? row.role),
        company: asString(row.company ?? row.company_name ?? row.organization),
        description: asString(row.description ?? row.summary)?.slice(0, 400),
        dateRange,
      };
    })
    .filter((row) => row.title || row.company)
    .slice(0, 8);
}

function parseEducation(value: unknown): CreatorEducation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        school: asString(row.school ?? row.institution ?? row.school_name),
        degree: asString(row.degree),
        field: asString(row.field ?? row.field_of_study),
      };
    })
    .filter((row) => row.school || row.degree)
    .slice(0, 5);
}

function parseLinkedInIntel(raw: Record<string, unknown>): CreatorLinkedInIntel {
  const firstName = asString(raw.first_name);
  const lastName = asString(raw.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || undefined;
  const publicIdentifier = asString(raw.public_identifier);
  const experiences = parseExperiences(
    raw.experiences ?? raw.work_experience ?? raw.positions ?? raw.experience,
  );
  const education = parseEducation(raw.education ?? raw.educations ?? raw.schools);
  const skills = parseStringList(raw.skills ?? raw.skill_list ?? raw.top_skills);
  const websites = parseStringList(raw.websites ?? raw.website ?? raw.contact_info);

  const rawFields = Object.keys(raw).filter((key) => {
    const value = raw[key];
    return value !== null && value !== undefined && value !== '';
  });

  return {
    platform: 'linkedin',
    providerId: asString(raw.provider_id),
    publicIdentifier,
    profileUrl: publicIdentifier
      ? `https://www.linkedin.com/in/${publicIdentifier}/`
      : undefined,
    fullName,
    headline: asString(raw.headline),
    summary: asString(raw.summary ?? raw.about ?? raw.description),
    location: asString(raw.location ?? raw.geo_location ?? raw.city),
    industry: asString(raw.industry),
    followerCount: asNumber(raw.follower_count ?? raw.followers_count),
    connectionCount: asNumber(raw.connections_count ?? raw.connection_count),
    experiences,
    education,
    skills,
    websites,
    rawFields,
  };
}

function parseTwitterIntel(raw: Record<string, unknown>, handle: string): CreatorTwitterIntel {
  const fullName = asString(raw.name ?? raw.full_name);
  const username = asString(raw.username ?? raw.screen_name ?? handle);
  return {
    platform: 'twitter',
    handle: username,
    fullName,
    bio: asString(raw.description ?? raw.bio ?? raw.summary),
    location: asString(raw.location),
    followerCount: asNumber(raw.followers_count ?? raw.follower_count),
    profileUrl: username ? `https://x.com/${username.replace(/^@/, '')}` : undefined,
  };
}

async function fetchUnipileUserProfile(
  unipileAccountId: string,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  try {
    const params = new URLSearchParams({ account_id: unipileAccountId });
    const res = await unipoleFetch(
      `/users/${encodeURIComponent(identifier)}?${params.toString()}`,
      { method: 'GET' },
    );
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchCreatorLinkedInIntel(
  unipileAccountId: string,
  identifier: string,
): Promise<CreatorLinkedInIntel | null> {
  const parsedId = parseLinkedInPublicIdentifier(identifier);
  const raw = await fetchUnipileUserProfile(unipileAccountId, parsedId);
  if (!raw) return null;
  return parseLinkedInIntel(raw);
}

export async function fetchCreatorTwitterIntel(
  unipileAccountId: string,
  identifier: string,
): Promise<CreatorTwitterIntel | null> {
  const handle = identifier.replace(/^@/, '').trim();
  if (!handle) return null;
  const raw = await fetchUnipileUserProfile(unipileAccountId, handle);
  if (!raw) return null;
  return parseTwitterIntel(raw, handle);
}

const WEB_FACTS_PROMPT = `You extract structured facts about a creator/professional from LinkedIn profile data and public web text.
Return ONLY valid JSON:
{
  "bio_summary": "3-5 sentence factual bio",
  "expertise": ["area of expertise"],
  "companies": ["company or org names"],
  "topics": ["content themes they are known for"],
  "audience": "who they write for",
  "proof_points": ["specific credentials, launches, metrics, roles"],
  "notable_work": ["products, talks, writing, projects"],
  "personal_angle": "what makes their perspective distinctive"
}
Use ONLY facts present in the input. No em dashes. Plain text.`;

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

function cleanStringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

async function extractCreatorWebFacts(
  combinedText: string,
  profileContext: string,
): Promise<Omit<CreatorWebIntel, 'queries' | 'sources'>> {
  const prompt = `Profile context:\n${profileContext}\n\nWeb + profile text:\n${combinedText.slice(0, MAX_WEB_CHARS)}`;
  const result = await generateContent(prompt, undefined, WEB_FACTS_PROMPT);
  const jsonText = extractJsonObject(result);
  if (!jsonText) {
    return {
      bioSummary: profileContext.slice(0, 500),
      expertise: [],
      companies: [],
      topics: [],
      proofPoints: [],
      notableWork: [],
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return {
      bioSummary: profileContext.slice(0, 500),
      expertise: [],
      companies: [],
      topics: [],
      proofPoints: [],
      notableWork: [],
    };
  }

  return {
    bioSummary: asString(parsed.bio_summary) ?? profileContext.slice(0, 500),
    expertise: cleanStringList(parsed.expertise, 8),
    companies: cleanStringList(parsed.companies, 6),
    topics: cleanStringList(parsed.topics, 8),
    audience: asString(parsed.audience),
    proofPoints: cleanStringList(parsed.proof_points, 8),
    notableWork: cleanStringList(parsed.notable_work, 8),
    personalAngle: asString(parsed.personal_angle),
  };
}

function buildSearchQueries(
  displayName: string,
  linkedin: CreatorLinkedInIntel | null,
  twitter: CreatorTwitterIntel | null,
): string[] {
  const queries: string[] = [];
  const headline = linkedin?.headline ?? twitter?.bio;
  const company = linkedin?.experiences?.[0]?.company;

  if (displayName && headline) {
    queries.push(`"${displayName}" ${headline}`);
  } else if (displayName) {
    queries.push(`"${displayName}" founder OR CEO OR creator`);
  }

  if (displayName && company) {
    queries.push(`"${displayName}" "${company}" interview OR podcast OR speaker`);
  }

  if (linkedin?.publicIdentifier) {
    queries.push(`site:linkedin.com/in/${linkedin.publicIdentifier}`);
  }

  return Array.from(new Set(queries)).slice(0, 3);
}

export async function researchCreatorOnWeb(
  displayName: string,
  linkedin: CreatorLinkedInIntel | null,
  twitter: CreatorTwitterIntel | null,
): Promise<CreatorWebIntel | null> {
  const queries = buildSearchQueries(displayName, linkedin, twitter);
  if (queries.length === 0) return null;

  const seenUrls = new Set<string>();
  const sourceUrls: string[] = [];

  for (const query of queries) {
    const results = await serperSearch(query);
    for (const result of results) {
      if (!result.link || seenUrls.has(result.link)) continue;
      seenUrls.add(result.link);
      sourceUrls.push(result.link);
      if (sourceUrls.length >= MAX_WEB_URLS) break;
    }
    if (sourceUrls.length >= MAX_WEB_URLS) break;
  }

  if (sourceUrls.length === 0) return null;

  const reads = await Promise.allSettled(sourceUrls.map((url) => jinaRead(url)));
  const chunks: string[] = [];
  const usedSources: string[] = [];

  reads.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      chunks.push(result.value);
      usedSources.push(sourceUrls[index]);
    }
  });

  const profileContext = [
    linkedin?.fullName && `Name: ${linkedin.fullName}`,
    linkedin?.headline && `Headline: ${linkedin.headline}`,
    linkedin?.summary && `LinkedIn summary: ${linkedin.summary}`,
    twitter?.bio && `X bio: ${twitter.bio}`,
  ]
    .filter(Boolean)
    .join('\n');

  const combined = [
    profileContext,
    chunks.length > 0 ? chunks.join('\n\n---\n\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (combined.trim().length < 80) return null;

  const extracted = await extractCreatorWebFacts(combined, profileContext);

  return {
    queries,
    sources: usedSources,
    ...extracted,
  };
}

function formatBioFacts(bundle: CreatorIntelBundle): string {
  const sections: string[] = [];

  if (bundle.linkedin) {
    const li = bundle.linkedin;
    const lines = [
      li.fullName && `Name: ${li.fullName}`,
      li.headline && `Headline: ${li.headline}`,
      li.summary && `About: ${li.summary}`,
      li.location && `Location: ${li.location}`,
      li.industry && `Industry: ${li.industry}`,
      li.experiences.length > 0 &&
        `Experience: ${li.experiences
          .map((exp) => [exp.title, exp.company].filter(Boolean).join(' at '))
          .join('; ')}`,
      li.education.length > 0 &&
        `Education: ${li.education
          .map((edu) => [edu.degree, edu.school].filter(Boolean).join(' — '))
          .join('; ')}`,
      li.skills.length > 0 && `Skills: ${li.skills.join(', ')}`,
    ].filter(Boolean);
    if (lines.length > 0) sections.push(`LINKEDIN PROFILE:\n${lines.join('\n')}`);
  }

  if (bundle.twitter) {
    const tw = bundle.twitter;
    const lines = [
      tw.fullName && `Name: ${tw.fullName}`,
      tw.handle && `Handle: @${tw.handle.replace(/^@/, '')}`,
      tw.bio && `Bio: ${tw.bio}`,
      tw.location && `Location: ${tw.location}`,
    ].filter(Boolean);
    if (lines.length > 0) sections.push(`X PROFILE:\n${lines.join('\n')}`);
  }

  if (bundle.web) {
    const web = bundle.web;
    const lines = [
      web.bioSummary && `Summary: ${web.bioSummary}`,
      web.expertise.length > 0 && `Expertise: ${web.expertise.join(', ')}`,
      web.companies.length > 0 && `Companies: ${web.companies.join(', ')}`,
      web.topics.length > 0 && `Known topics: ${web.topics.join(', ')}`,
      web.audience && `Audience: ${web.audience}`,
      web.proofPoints.length > 0 && `Proof points: ${web.proofPoints.join('; ')}`,
      web.notableWork.length > 0 && `Notable work: ${web.notableWork.join('; ')}`,
      web.personalAngle && `Angle: ${web.personalAngle}`,
      web.sources.length > 0 && `Sources: ${web.sources.join(', ')}`,
    ].filter(Boolean);
    if (lines.length > 0) sections.push(`WEB RESEARCH:\n${lines.join('\n')}`);
  }

  return sections.join('\n\n').trim();
}

/**
 * Pulls LinkedIn/X profile fields via Unipile and enriches with public web research.
 */
export async function gatherCreatorIntel(
  accounts: SocialAccountRow[],
  displayName: string,
): Promise<CreatorIntelBundle> {
  let linkedin: CreatorLinkedInIntel | null = null;
  let twitter: CreatorTwitterIntel | null = null;

  for (const account of accounts) {
    const identifier = account.account_id ?? account.account_name;
    if (!identifier) continue;

    try {
      if (account.platform === 'linkedin' && !linkedin) {
        linkedin = await fetchCreatorLinkedInIntel(account.unipile_account_id, identifier);
      }
      if (account.platform === 'twitter' && !twitter) {
        twitter = await fetchCreatorTwitterIntel(account.unipile_account_id, identifier);
      }
    } catch (err) {
      console.warn(`[creator-intel] profile fetch failed for ${account.platform}:`, err);
    }
  }

  const resolvedName = linkedin?.fullName ?? twitter?.fullName ?? displayName;

  let web: CreatorWebIntel | null = null;
  try {
    web = await researchCreatorOnWeb(resolvedName, linkedin, twitter);
  } catch (err) {
    console.warn('[creator-intel] web research failed:', err);
  }

  const bundle: CreatorIntelBundle = {
    linkedin,
    twitter,
    web,
    bioFacts: '',
  };
  bundle.bioFacts = formatBioFacts(bundle);
  return bundle;
}
