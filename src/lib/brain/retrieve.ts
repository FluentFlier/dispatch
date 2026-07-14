import type { createClient } from '@insforge/sdk';
import { BRAIN_SLUG } from './types';
import { getBrainPage, listBrainPages } from './pages';

type InsforgeClient = ReturnType<typeof createClient>;

function pageToSnippet(slug: string, body: string): string {
  if (slug === BRAIN_SLUG.savedReferences) {
    return body.trim().slice(0, 1200);
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (slug === BRAIN_SLUG.voice) {
      // syncBrainVoiceLab writes vocabulary_fingerprint + structural_patterns into
      // this page but they were never read back - dead storage. Read them so the
      // brain voice page is a real fingerprint source (fallback/reinforcement for
      // the user_settings copy), not just voice_description + voice_rules.
      const vocab = parsed.vocabulary_fingerprint as
        | { uses_often?: string[]; signature_phrases?: string[] }
        | undefined;
      const structural = parsed.structural_patterns as
        | { hook_pattern?: string; closing_pattern?: string }
        | undefined;
      const parts = [
        parsed.voice_description && `Voice: ${parsed.voice_description}`,
        parsed.voice_rules && `Rules: ${parsed.voice_rules}`,
        vocab?.uses_often?.length && `Uses often: ${vocab.uses_often.join(', ')}`,
        vocab?.signature_phrases?.length &&
          `Signature phrases: ${vocab.signature_phrases.join(', ')}`,
        structural?.hook_pattern && `Opens: ${structural.hook_pattern}`,
        structural?.closing_pattern && `Closes: ${structural.closing_pattern}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug === BRAIN_SLUG.profile) {
      const parts = [
        parsed.bio_facts && `Facts: ${parsed.bio_facts}`,
        parsed.bio && `Bio: ${parsed.bio}`,
        parsed.linkedin_headline && `Headline: ${parsed.linkedin_headline}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug === BRAIN_SLUG.linkedin) {
      const parts = [
        parsed.headline && `Headline: ${parsed.headline}`,
        parsed.summary && `About: ${parsed.summary}`,
        parsed.location && `Location: ${parsed.location}`,
        Array.isArray(parsed.experiences) &&
          parsed.experiences.length > 0 &&
          `Experience: ${(parsed.experiences as Array<{ title?: string; company?: string }>)
            .slice(0, 4)
            .map((exp) => [exp.title, exp.company].filter(Boolean).join(' at '))
            .join('; ')}`,
        Array.isArray(parsed.skills) &&
          (parsed.skills as string[]).length > 0 &&
          `Skills: ${(parsed.skills as string[]).slice(0, 8).join(', ')}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug === BRAIN_SLUG.twitter) {
      const parts = [
        parsed.handle && `Handle: @${String(parsed.handle).replace(/^@/, '')}`,
        parsed.bio && `Bio: ${parsed.bio}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug === BRAIN_SLUG.background) {
      const parts = [
        parsed.bioSummary && `Summary: ${parsed.bioSummary}`,
        Array.isArray(parsed.expertise) &&
          (parsed.expertise as string[]).length > 0 &&
          `Expertise: ${(parsed.expertise as string[]).join(', ')}`,
        Array.isArray(parsed.topics) &&
          (parsed.topics as string[]).length > 0 &&
          `Topics: ${(parsed.topics as string[]).join(', ')}`,
        Array.isArray(parsed.proofPoints) &&
          (parsed.proofPoints as string[]).length > 0 &&
          `Proof: ${(parsed.proofPoints as string[]).join('; ')}`,
        parsed.personalAngle && `Angle: ${parsed.personalAngle}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug === BRAIN_SLUG.wins) {
      const top = parsed.top_posts as Array<{ title?: string; snippet?: string; views?: number }> | undefined;
      if (!top?.length) return '';
      return `Top performing posts:\n${top
        .slice(0, 3)
        .map((p, i) => `${i + 1}. ${p.title} (${p.views ?? 0} views): ${p.snippet ?? ''}`)
        .join('\n')}`;
    }
    if (slug === BRAIN_SLUG.gtm) {
      const parts = [
        parsed.icp && `ICP: ${parsed.icp}`,
        parsed.pitch && `Pitch: ${parsed.pitch}`,
        parsed.objections && `Objections: ${parsed.objections}`,
        parsed.proof_points && `Proof: ${parsed.proof_points}`,
        parsed.cta_style && `CTA style: ${parsed.cta_style}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug.startsWith('post/') && parsed.content) {
      return `Published ${parsed.platform ?? ''} (${parsed.pillar ?? ''}): ${String(parsed.content).slice(0, 400)}`;
    }
    return JSON.stringify(parsed).slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

function scorePageRelevance(body: string, query: string): number {
  const q = query.toLowerCase();
  const text = body.toLowerCase();
  if (text.includes(q)) return 2;
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  return words.filter((w) => text.includes(w)).length;
}

/**
 * Retrieves creator brain context for AI generation.
 * Always includes core pages; adds relevant published posts when query provided.
 * When workspaceId is provided, all page lookups are scoped to that workspace
 * so agency clients only see their own brain content.
 *
 * The GTM playbook (ICP/pitch/objections/CTA) is OUTREACH context - it is only
 * included when `includeGtm` is true (outreach/reply generation). Injecting it
 * into ordinary content posts caused sales-pitch bleed into unrelated topics.
 */
export async function retrieveBrainContext(
  client: InsforgeClient,
  userId: string,
  query?: string,
  workspaceId?: string,
  includeGtm = false,
): Promise<string[]> {
  const snippets: string[] = [];

  const coreSlugs = includeGtm
    ? [
        BRAIN_SLUG.voice,
        BRAIN_SLUG.profile,
        BRAIN_SLUG.linkedin,
        BRAIN_SLUG.twitter,
        BRAIN_SLUG.background,
        BRAIN_SLUG.wins,
        BRAIN_SLUG.gtm,
      ]
    : [
        BRAIN_SLUG.voice,
        BRAIN_SLUG.profile,
        BRAIN_SLUG.linkedin,
        BRAIN_SLUG.twitter,
        BRAIN_SLUG.background,
        BRAIN_SLUG.wins,
      ];
  for (const slug of coreSlugs) {
    // Pass workspaceId so the page fetch is scoped to the correct workspace.
    const page = await getBrainPage(client, userId, slug, workspaceId);
    if (!page?.body || page.body.includes('"status":"pending"')) continue;
    const snippet = pageToSnippet(slug, page.body);
    if (snippet.trim()) {
      snippets.push(`[${slug}]\n${snippet}`);
    }
  }

  const savedRefs = await getBrainPage(client, userId, BRAIN_SLUG.savedReferences, workspaceId);
  if (savedRefs?.body?.trim() && !savedRefs.body.includes('"status":"pending"')) {
    const snippet = pageToSnippet(BRAIN_SLUG.savedReferences, savedRefs.body);
    if (snippet.trim()) {
      snippets.push(`[${BRAIN_SLUG.savedReferences}]\n${snippet}`);
    }
  }

  if (query?.trim()) {
    // Scope list to workspace so post lookups don't bleed across clients.
    const pages = await listBrainPages(client, userId, workspaceId);
    const postPages = pages
      .filter((p) => p.slug.startsWith('post/'))
      .map((p) => ({ page: p, score: scorePageRelevance(p.body, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { page } of postPages) {
      const snippet = pageToSnippet(page.slug, page.body);
      if (snippet.trim()) {
        snippets.push(`[${page.slug}]\n${snippet}`);
      }
    }
  }

  return snippets;
}
