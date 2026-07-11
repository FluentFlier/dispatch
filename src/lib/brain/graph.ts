import type { BrainPageRecord } from './types';

/**
 * Visual grouping for a brain graph node. Drives node color, size, and legend.
 * `core` = identity/voice pages, `performance` = wins, `gtm` = outreach playbook,
 * `references` = saved hooks, `pillar` = content pillar derived from profile,
 * `post` = a published post memory, `story` = a story-bank memory.
 */
export type BrainNodeKind =
  | 'core'
  | 'performance'
  | 'gtm'
  | 'references'
  | 'pillar'
  | 'post'
  | 'story';

export interface BrainGraphNode {
  id: string;
  label: string;
  kind: BrainNodeKind;
  /** Original brain page slug when the node maps to a stored page. */
  slug?: string;
  /** One-line description shown in the detail panel. */
  detail?: string;
  /** Small key/value facts (views, likes, platform, updated) for the panel. */
  meta?: Record<string, string | number>;
}

export type BrainEdgeKind = 'structural' | 'pillar' | 'win';

export interface BrainGraphEdge {
  source: string;
  target: string;
  kind: BrainEdgeKind;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
}

/** Slug -> presentation metadata for the fixed "core" brain pages. */
const CORE_META: Record<string, { label: string; kind: BrainNodeKind }> = {
  profile: { label: 'Profile', kind: 'core' },
  voice: { label: 'Voice', kind: 'core' },
  linkedin: { label: 'LinkedIn', kind: 'core' },
  twitter: { label: 'X / Twitter', kind: 'core' },
  background: { label: 'Background', kind: 'core' },
  wins: { label: 'What works', kind: 'performance' },
  gtm: { label: 'GTM playbook', kind: 'gtm' },
  'saved-references': { label: 'Saved references', kind: 'references' },
};

const ROOT_ID = 'profile';

function safeParse(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Normalize content_pillars (array of strings or {value,label} objects). */
function extractPillars(profileBody: Record<string, unknown> | null): { id: string; label: string }[] {
  if (!profileBody) return [];
  const raw = profileBody.content_pillars;
  if (!Array.isArray(raw)) return [];

  const out: { id: string; label: string }[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const id = item.trim().toLowerCase().replace(/\s+/g, '-');
      if (id) out.push({ id, label: item.trim() });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const value = typeof obj.value === 'string' ? obj.value : typeof obj.id === 'string' ? obj.id : '';
      const label = typeof obj.label === 'string' ? obj.label : typeof obj.name === 'string' ? obj.name : value;
      const id = (value || label).trim().toLowerCase().replace(/\s+/g, '-');
      if (id) out.push({ id, label: (label || value).trim() });
    }
  }
  return out;
}

function truncate(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Build a short human description for a core/gtm/references page from its body. */
function describeCorePage(page: BrainPageRecord): string | undefined {
  const parsed = safeParse(page.body);
  if (parsed) {
    if (parsed.status === 'pending') return 'Not populated yet — sync or complete onboarding.';
    if (typeof parsed.voice_description === 'string' && parsed.voice_description) {
      return truncate(parsed.voice_description);
    }
    if (typeof parsed.bio === 'string' && parsed.bio) return truncate(parsed.bio);
    if (typeof parsed.icp === 'string' && parsed.icp) return truncate(`ICP: ${parsed.icp}`);
    return undefined;
  }
  // Non-JSON body (e.g. saved-references is plain text).
  return page.body ? truncate(page.body) : undefined;
}

/**
 * Transforms a creator's brain pages into a connected node/edge graph.
 *
 * Layout is intentionally hub-and-spoke: the `profile` page is the center,
 * identity pages hang off it, content pillars branch from profile, and post
 * memories attach to the pillar they belong to (falling back to `wins`, then
 * profile). Wins additionally draw a "win" edge to their top posts. The graph
 * is always connected so orphan nodes never float away in the force layout.
 */
export function buildBrainGraph(pages: BrainPageRecord[]): BrainGraph {
  const nodes: BrainGraphNode[] = [];
  const edges: BrainGraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: BrainGraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  // Always guarantee a root so the graph is connected even before profile syncs.
  const profilePage = pages.find((p) => p.slug === 'profile');
  const profileBody = profilePage ? safeParse(profilePage.body) : null;
  addNode({
    id: ROOT_ID,
    label: profilePage?.title?.replace(/:\s*profile$/i, '') || 'Creator',
    kind: 'core',
    slug: 'profile',
    detail: profilePage ? describeCorePage(profilePage) : 'The center of your Creator Brain.',
  });

  // Content pillars branch directly off the profile hub.
  const pillars = extractPillars(profileBody);
  const pillarIdByToken = new Map<string, string>();
  for (const pillar of pillars) {
    const nodeId = `pillar:${pillar.id}`;
    addNode({ id: nodeId, label: pillar.label, kind: 'pillar', detail: 'Content pillar' });
    edges.push({ source: ROOT_ID, target: nodeId, kind: 'pillar' });
    pillarIdByToken.set(pillar.id, nodeId);
    pillarIdByToken.set(pillar.label.toLowerCase(), nodeId);
  }

  const hasWins = pages.some((p) => p.slug === 'wins');

  for (const page of pages) {
    const { slug } = page;
    if (slug === 'profile') continue;

    if (slug.startsWith('post/')) {
      const body = safeParse(page.body);
      const platform = typeof body?.platform === 'string' ? body.platform : undefined;
      const pillarToken = typeof body?.pillar === 'string' ? body.pillar.toLowerCase() : undefined;
      const views = typeof body?.views === 'number' ? body.views : undefined;
      const likes = typeof body?.likes === 'number' ? body.likes : undefined;

      const meta: Record<string, string | number> = {};
      if (platform) meta.platform = platform;
      if (typeof views === 'number') meta.views = views;
      if (typeof likes === 'number') meta.likes = likes;

      addNode({
        id: slug,
        label: truncate(page.title || 'Post', 40),
        kind: 'post',
        slug,
        detail: typeof body?.content === 'string' ? truncate(body.content) : 'Published post memory.',
        meta: Object.keys(meta).length ? meta : undefined,
      });

      // Attach to its pillar, else to wins, else to the profile hub.
      const pillarTarget = pillarToken ? pillarIdByToken.get(pillarToken) : undefined;
      if (pillarTarget) {
        edges.push({ source: pillarTarget, target: slug, kind: 'structural' });
      } else if (hasWins) {
        edges.push({ source: 'wins', target: slug, kind: 'structural' });
      } else {
        edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
      }
      continue;
    }

    if (slug.startsWith('story/')) {
      addNode({
        id: slug,
        label: truncate(page.title || 'Story', 40),
        kind: 'story',
        slug,
        detail: truncate(page.body),
      });
      edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
      continue;
    }

    const core = CORE_META[slug];
    if (core) {
      addNode({
        id: slug,
        label: core.label,
        kind: core.kind,
        slug,
        detail: describeCorePage(page),
      });
      edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
      continue;
    }

    // Unknown slug — still surface it rather than dropping data silently.
    addNode({ id: slug, label: truncate(page.title || slug, 40), kind: 'core', slug, detail: describeCorePage(page) });
    edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
  }

  // Saved references inform the voice — draw the semantic link when both exist.
  if (nodeIds.has('saved-references') && nodeIds.has('voice')) {
    edges.push({ source: 'saved-references', target: 'voice', kind: 'structural' });
  }

  // Wins -> top posts (win edges) from the wins page body.
  const winsPage = pages.find((p) => p.slug === 'wins');
  if (winsPage) {
    const body = safeParse(winsPage.body);
    const topPosts = Array.isArray(body?.top_posts) ? body?.top_posts : [];
    for (const entry of topPosts as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const postId = (entry as Record<string, unknown>).post_id;
      if (typeof postId !== 'string') continue;
      const target = `post/${postId}`;
      if (nodeIds.has(target)) {
        edges.push({ source: 'wins', target, kind: 'win' });
      }
    }
  }

  return { nodes, edges };
}
