import type { BrainPageRecord } from './types';

/**
 * Visual grouping for a brain graph node. Drives node color, size, and legend.
 */
export type BrainNodeKind =
  | 'core'
  | 'performance'
  | 'gtm'
  | 'references'
  | 'pillar'
  | 'post'
  | 'story'
  | 'topic';

export interface BrainGraphNode {
  id: string;
  label: string;
  kind: BrainNodeKind;
  slug?: string;
  detail?: string;
  meta?: Record<string, string | number>;
  /** Normalized performance weight in [0, 1] - drives node size for posts/pillars. */
  weight?: number;
  /** Top performer from the wins page. */
  highlight?: boolean;
  /** Brain page is still a stub / not populated. */
  pending?: boolean;
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

function isPagePending(page: BrainPageRecord): boolean {
  if (!page.body?.trim()) return true;
  if (page.body.includes('"status":"pending"') || page.body.includes('"status": "pending"')) return true;
  const parsed = safeParse(page.body);
  return parsed?.status === 'pending';
}

function countReferenceHooks(body: string): number {
  if (!body.trim()) return 0;
  const parsed = safeParse(body);
  if (parsed && Array.isArray(parsed.entries)) return parsed.entries.length;
  return body.split(/\n{2,}/).filter((block) => block.trim().length > 20).length;
}

function matchStoryToPillar(
  body: Record<string, unknown> | null,
  pillarIdByToken: Map<string, string>,
): string | undefined {
  if (!body) return undefined;
  const category = typeof body.category === 'string' ? body.category.toLowerCase() : '';
  if (category && pillarIdByToken.has(category)) return pillarIdByToken.get(category);

  const tags = Array.isArray(body.tags) ? body.tags : [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const token = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (pillarIdByToken.has(token)) return pillarIdByToken.get(token);
  }
  return undefined;
}

function describeCorePage(page: BrainPageRecord): string | undefined {
  const parsed = safeParse(page.body);
  if (parsed) {
    if (parsed.status === 'pending') return 'Not populated yet - sync or complete onboarding.';
    if (typeof parsed.voice_description === 'string' && parsed.voice_description) {
      return truncate(parsed.voice_description);
    }
    if (typeof parsed.bio === 'string' && parsed.bio) return truncate(parsed.bio);
    if (typeof parsed.icp === 'string' && parsed.icp) return truncate(`ICP: ${parsed.icp}`);
    if (typeof parsed.bioSummary === 'string' && parsed.bioSummary) return truncate(parsed.bioSummary);
    if (typeof parsed.headline === 'string' && parsed.headline) return truncate(parsed.headline);
    return undefined;
  }
  return page.body ? truncate(page.body) : undefined;
}

function voiceMeta(body: Record<string, unknown> | null): Record<string, string | number> | undefined {
  if (!body || body.status === 'pending') return undefined;
  const meta: Record<string, string | number> = {};
  const vocab = body.vocabulary_fingerprint as { uses_often?: string[] } | undefined;
  if (vocab?.uses_often?.length) meta['Signature terms'] = vocab.uses_often.length;
  if (typeof body.voice_rules === 'string' && body.voice_rules.trim()) meta.Rules = 'Set';
  return Object.keys(meta).length ? meta : undefined;
}

function gtmMeta(body: Record<string, unknown> | null): Record<string, string | number> | undefined {
  if (!body || body.status === 'pending') return undefined;
  const fields = ['icp', 'pitch', 'objections', 'proof_points', 'cta_style'] as const;
  const filled = fields.filter((f) => typeof body[f] === 'string' && String(body[f]).trim().length > 8);
  return { 'Fields filled': `${filled.length}/${fields.length}` };
}

function backgroundMeta(body: Record<string, unknown> | null): Record<string, string | number> | undefined {
  if (!body) return undefined;
  const meta: Record<string, string | number> = {};
  const topics = Array.isArray(body.topics) ? body.topics : [];
  if (topics.length) meta.Topics = topics.length;
  const expertise = Array.isArray(body.expertise) ? body.expertise : [];
  if (expertise.length) meta.Expertise = expertise.length;
  return Object.keys(meta).length ? meta : undefined;
}

const TOPIC_STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'your', 'have', 'will', 'they', 'them', 'what', 'when', 'which',
  'about', 'would', 'there', 'their', 'been', 'were', 'into', 'more', 'than', 'then', 'some', 'just',
  'like', 'over', 'also', 'only', 'very', 'much', 'make', 'made', 'need', 'want', 'know', 'time',
  'post', 'posts', 'content', 'people', 'thing', 'things', 'really', 'something', 'because', 'after',
  'before', 'other', 'these', 'those', 'being', 'doing', 'does', 'still', 'even', 'most', 'many',
  'such', 'here', 'where', 'while', 'should', 'could', 'around', 'them', 'this', 'https', 'http',
  'linkedin', 'twitter', 'instagram', 'threads', 'share', 'follow', 'comment', 'today', 'week',
]);

function topicTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !TOPIC_STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Mines recurring topics from post text using document frequency (how many posts
 * a term appears in). Heuristic, no LLM. Terms matching a pillar label are
 * excluded to avoid redundant nodes.
 */
export function extractTopics(
  postTexts: { id: string; text: string }[],
  exclude: Set<string>,
  minPosts: number,
  limit: number,
): { term: string; label: string; postIds: string[] }[] {
  const byTerm = new Map<string, Set<string>>();
  for (const post of postTexts) {
    for (const term of Array.from(new Set(topicTokens(post.text)))) {
      if (exclude.has(term)) continue;
      const ids = byTerm.get(term) ?? new Set<string>();
      ids.add(post.id);
      byTerm.set(term, ids);
    }
  }
  return Array.from(byTerm.entries())
    .map(([term, ids]) => ({ term, label: term.charAt(0).toUpperCase() + term.slice(1), postIds: Array.from(ids) }))
    .filter((t) => t.postIds.length >= minPosts)
    .sort((a, b) => b.postIds.length - a.postIds.length)
    .slice(0, limit);
}

/**
 * Transforms brain pages into a connected graph where every learning signal
 * (voice, intel, posts, stories, GTM, references) shapes nodes, weights, and edges.
 */
export function buildBrainGraph(pages: BrainPageRecord[]): BrainGraph {
  const nodes: BrainGraphNode[] = [];
  const edges: BrainGraphEdge[] = [];
  const nodeIds = new Set<string>();
  const nodeById = new Map<string, BrainGraphNode>();
  const postScores = new Map<string, number>();
  const postTexts: { id: string; text: string }[] = [];

  const addNode = (node: BrainGraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
    nodes.push(node);
  };

  const profilePage = pages.find((p) => p.slug === 'profile');
  const profileBody = profilePage ? safeParse(profilePage.body) : null;
  addNode({
    id: ROOT_ID,
    label: profilePage?.title?.replace(/:\s*profile$/i, '') || 'Creator',
    kind: 'core',
    slug: 'profile',
    detail: profilePage ? describeCorePage(profilePage) : 'The center of your Brain.',
    pending: profilePage ? isPagePending(profilePage) : true,
  });

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

      postScores.set(slug, Math.max(views ?? 0, (likes ?? 0) * 8));
      const postContent = typeof body?.content === 'string' ? body.content : '';
      postTexts.push({ id: slug, text: `${page.title ?? ''} ${postContent}` });

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
      const body = safeParse(page.body);
      const content =
        typeof body?.content === 'string'
          ? body.content
          : typeof page.body === 'string' && !page.body.startsWith('{')
            ? page.body
            : '';
      addNode({
        id: slug,
        label: truncate(page.title || 'Story', 40),
        kind: 'story',
        slug,
        detail: truncate(content || 'Story memory'),
        meta: typeof body?.category === 'string' ? { Category: body.category } : undefined,
      });

      const pillarTarget = matchStoryToPillar(body, pillarIdByToken);
      if (pillarTarget) {
        edges.push({ source: pillarTarget, target: slug, kind: 'structural' });
      } else {
        edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
      }
      continue;
    }

    const core = CORE_META[slug];
    if (core) {
      const parsed = safeParse(page.body);
      let meta: Record<string, string | number> | undefined;
      if (slug === 'voice') meta = voiceMeta(parsed);
      else if (slug === 'gtm') meta = gtmMeta(parsed);
      else if (slug === 'background') meta = backgroundMeta(parsed);
      else if (slug === 'saved-references') {
        const count = countReferenceHooks(page.body);
        if (count > 0) meta = { 'Saved hooks': count };
      } else if (slug === 'linkedin' && parsed?.headline) {
        meta = { Headline: 'Set' };
      }

      addNode({
        id: slug,
        label: core.label,
        kind: core.kind,
        slug,
        detail: describeCorePage(page),
        meta,
        pending: isPagePending(page),
      });
      edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
      continue;
    }

    addNode({
      id: slug,
      label: truncate(page.title || slug, 40),
      kind: 'core',
      slug,
      detail: describeCorePage(page),
      pending: isPagePending(page),
    });
    edges.push({ source: ROOT_ID, target: slug, kind: 'structural' });
  }

  if (nodeIds.has('saved-references') && nodeIds.has('voice')) {
    edges.push({ source: 'saved-references', target: 'voice', kind: 'structural' });
  }
  if (nodeIds.has('background') && nodeIds.has('voice')) {
    edges.push({ source: 'background', target: 'voice', kind: 'structural' });
  }

  const winsPage = pages.find((p) => p.slug === 'wins');
  if (winsPage) {
    const body = safeParse(winsPage.body);
    const topPosts = Array.isArray(body?.top_posts) ? body?.top_posts : [];
    for (const entry of topPosts as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const postId = (entry as Record<string, unknown>).post_id;
      if (typeof postId !== 'string') continue;
      const target = `post/${postId}`;
      const targetNode = nodeById.get(target);
      if (targetNode) {
        edges.push({ source: 'wins', target, kind: 'win' });
        targetNode.highlight = true;
      }
    }
  }

  const maxScore = Math.max(0, ...Array.from(postScores.values()));
  if (maxScore > 0) {
    postScores.forEach((score, id) => {
      const node = nodeById.get(id);
      if (node) node.weight = Math.sqrt(score / maxScore);
    });
  }

  const pillarScores = new Map<string, number>();
  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) return;
    if (sourceNode.kind === 'pillar' && targetNode.kind === 'post') {
      pillarScores.set(sourceNode.id, (pillarScores.get(sourceNode.id) ?? 0) + (postScores.get(targetNode.id) ?? 0));
    }
  });

  const maxPillarScore = Math.max(0, ...Array.from(pillarScores.values()));
  if (maxPillarScore > 0) {
    pillarScores.forEach((score, id) => {
      const node = nodeById.get(id);
      if (node?.kind === 'pillar') node.weight = Math.sqrt(score / maxPillarScore);
    });
  }

  // --- Recurring topics mined from post text (relational cross-links) ---
  // Posts sharing a theme become linked through a topic node, turning the star
  // into a web. Exclude pillar labels so topics don't duplicate pillars.
  const pillarLabelTokens = new Set(pillars.flatMap((p) => topicTokens(p.label)));
  const topics = extractTopics(postTexts, pillarLabelTokens, 3, 6);
  for (const topic of topics) {
    const topicId = `topic:${topic.term}`;
    addNode({
      id: topicId,
      label: topic.label,
      kind: 'topic',
      detail: `Recurring theme across ${topic.postIds.length} posts.`,
    });
    for (const postId of topic.postIds) {
      if (nodeIds.has(postId)) edges.push({ source: postId, target: topicId, kind: 'structural' });
    }
  }

  return { nodes, edges };
}
