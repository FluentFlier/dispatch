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
      const parts = [
        parsed.voice_description && `Voice: ${parsed.voice_description}`,
        parsed.voice_rules && `Rules: ${parsed.voice_rules}`,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (slug === BRAIN_SLUG.profile) {
      const parts = [
        parsed.bio_facts && `Facts: ${parsed.bio_facts}`,
        parsed.bio && `Bio: ${parsed.bio}`,
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
 * The GTM playbook (ICP/pitch/objections/CTA) is OUTREACH context — it is only
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
    ? [BRAIN_SLUG.voice, BRAIN_SLUG.profile, BRAIN_SLUG.wins, BRAIN_SLUG.gtm]
    : [BRAIN_SLUG.voice, BRAIN_SLUG.profile, BRAIN_SLUG.wins];
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
