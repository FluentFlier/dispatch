'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, type ZoomBehavior } from 'd3-zoom';
import type { BrainGraph, BrainGraphNode, BrainNodeKind } from '@/lib/brain/graph';

interface BrainGraphCanvasProps {
  graph: BrainGraph;
  selectedId: string | null;
  onSelect: (node: BrainGraphNode | null) => void;
  /** Externally highlight a node (e.g. from a decision card). */
  focusId?: string | null;
  /** Highlight a set of nodes (e.g. from a learning) — dims everything else. */
  highlightIds?: string[];
}

const KIND_STYLE: Record<BrainNodeKind, { fill: string; radius: number }> = {
  core: { fill: '#2563EB', radius: 13 },
  performance: { fill: '#0F766E', radius: 14 },
  gtm: { fill: '#E8543A', radius: 13 },
  references: { fill: '#8B7BB8', radius: 12 },
  pillar: { fill: '#1F1B16', radius: 12 },
  post: { fill: '#5B8FA8', radius: 7 },
  story: { fill: '#E07A5F', radius: 8 },
};

export const KIND_LABELS: Record<BrainNodeKind, string> = {
  core: 'Identity & voice',
  performance: 'What works',
  gtm: 'GTM playbook',
  references: 'Saved references',
  pillar: 'Content pillar',
  post: 'Published post',
  story: 'Story memory',
};

const PROFILE_RADIUS = 24;
const GOLDEN_ANGLE = 2.399963229728653;

function nodeRadius(node: BrainGraphNode): number {
  if (node.id === 'profile') return PROFILE_RADIUS;
  if (node.kind === 'post') {
    const base = KIND_STYLE.post.radius;
    return base + (node.weight ?? 0.15) * 11 + (node.highlight ? 2 : 0);
  }
  if (node.kind === 'pillar') {
    const base = KIND_STYLE.pillar.radius;
    return base + (node.weight ?? 0.15) * 6;
  }
  return KIND_STYLE[node.kind].radius;
}

type SimNode = SimulationNodeDatum & BrainGraphNode;
type SimLink = SimulationLinkDatum<SimNode> & { kind: BrainGraph['edges'][number]['kind'] };

/** Ideal edge length (px) — pillars hug their posts/stories, core spreads out. */
function linkDistance(link: SimLink): number {
  const a = link.source as SimNode;
  const b = link.target as SimNode;
  const kinds = new Set([a.kind, b.kind]);
  const involvesLeaf = kinds.has('post') || kinds.has('story');
  if (kinds.has('pillar') && involvesLeaf) return 46;
  if (involvesLeaf) return 66;
  if (kinds.has('pillar')) return 128;
  return 104;
}

export function BrainGraphCanvas({ graph, selectedId, onSelect, focusId, highlightIds }: BrainGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  // Bumped on every simulation tick to re-render node/edge positions.
  const [, setFrame] = useState(0);

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const simNodesRef = useRef<SimNode[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);

  // --- Track container size ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Build / rebuild the force simulation when the graph changes ---
  useEffect(() => {
    const prev = new Map(simNodesRef.current.map((n) => [n.id, n]));
    const { w, h } = sizeRef.current;
    const cx = w / 2;
    const cy = h / 2;

    const nodes: SimNode[] = graph.nodes.map((node, i) => {
      const carried = prev.get(node.id);
      if (carried && carried.x != null && carried.y != null) {
        return { ...node, x: carried.x, y: carried.y, vx: 0, vy: 0 };
      }
      if (node.id === 'profile') return { ...node, x: cx, y: cy };
      // Deterministic phyllotaxis seed around the center so nodes fan out on settle.
      const angle = i * GOLDEN_ANGLE;
      const r = 30 + 12 * Math.sqrt(i);
      return { ...node, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = graph.edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, kind: e.kind }));

    const sim = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(linkDistance).strength(0.7))
      .force('charge', forceManyBody<SimNode>().strength((d) => -26 * nodeRadius(d)))
      .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d) + 7).strength(0.9))
      .force('center', forceCenter(cx, cy).strength(0.05))
      .force('x', forceX<SimNode>(cx).strength(0.045))
      .force('y', forceY<SimNode>(cy).strength(0.045))
      .alpha(1)
      .alphaDecay(0.028);

    sim.on('tick', () => {
      // Keep the profile node pinned at the current center (follows resizes).
      const profile = nodeById.get('profile');
      if (profile) {
        profile.x = sizeRef.current.w / 2;
        profile.y = sizeRef.current.h / 2;
      }
      setFrame((f) => (f + 1) % 1_000_000);
    });

    simNodesRef.current = nodes;
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [graph]);

  // --- Zoom / pan (background only; node drags are handled separately) ---
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const behavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 4])
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        const target = event.target as Element | null;
        return !target?.closest?.('[data-node="true"]');
      })
      .on('zoom', (event) => {
        const t = event.transform;
        setTransform({ k: t.k, x: t.x, y: t.y });
      });
    const sel = select(svgEl);
    sel.call(behavior);
    sel.on('dblclick.zoom', null);
    return () => {
      sel.on('.zoom', null);
    };
  }, []);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of graph.nodes) map.set(node.id, new Set());
    for (const e of graph.edges) {
      map.get(e.source)?.add(e.target);
      map.get(e.target)?.add(e.source);
    }
    return map;
  }, [graph]);

  const highlightSet = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);
  const activeId = hoverId ?? selectedId ?? focusId ?? null;
  const activeNeighbors = activeId ? neighbors.get(activeId) : null;

  const isDimmed = (id: string): boolean => {
    if (highlightSet.size > 0) return !highlightSet.has(id);
    if (!activeId || id === activeId) return false;
    return !(activeNeighbors?.has(id) ?? false);
  };

  const toGraphPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const t = transformRef.current;
    const px = clientX - (rect?.left ?? 0);
    const py = clientY - (rect?.top ?? 0);
    return { x: (px - t.x) / t.k, y: (py - t.y) / t.k };
  };

  const nodePos = new Map(simNodesRef.current.map((n) => [n.id, n]));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-surface border border-hair bg-[radial-gradient(130%_130%_at_50%_-10%,#FFFFFF_0%,#F8F6F0_55%,#EFEBE1_100%)]"
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="block touch-none select-none"
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
      >
        <defs>
          <filter id="brain-node-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#2B2417" floodOpacity="0.18" />
          </filter>
          <filter id="brain-win-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background hit target — click empty space to deselect. */}
        <rect
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          fill="transparent"
          onClick={() => onSelect(null)}
        />

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {graph.edges.map((e, i) => {
            const s = nodePos.get(e.source);
            const t = nodePos.get(e.target);
            if (!s || s.x == null || !t || t.x == null) return null;
            const dim =
              highlightSet.size > 0
                ? !(highlightSet.has(e.source) && highlightSet.has(e.target))
                : isDimmed(e.source) && isDimmed(e.target);
            const isWin = e.kind === 'win';
            const mx = (s.x! + t.x!) / 2;
            const my = (s.y! + t.y!) / 2;
            const dx = t.x! - s.x!;
            const dy = t.y! - s.y!;
            const nlen = Math.hypot(-dy, dx) || 1;
            const bend = Math.min(26, Math.hypot(dx, dy) * 0.11);
            const cx = mx + (-dy / nlen) * bend;
            const cy = my + (dx / nlen) * bend;
            return (
              <path
                key={`${e.source}->${e.target}-${i}`}
                d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
                fill="none"
                stroke={isWin ? '#0F766E' : '#2B2417'}
                strokeOpacity={dim ? 0.04 : isWin ? 0.55 : 0.11}
                strokeWidth={isWin ? 1.9 : 1}
                strokeDasharray={e.kind === 'pillar' ? '4 5' : undefined}
                strokeLinecap="round"
                filter={isWin && !dim ? 'url(#brain-win-glow)' : undefined}
                style={{ transition: 'stroke-opacity 0.15s ease' }}
              />
            );
          })}

          {graph.nodes.map((node) => {
            const p = nodePos.get(node.id);
            if (!p || p.x == null || p.y == null) return null;
            const style = KIND_STYLE[node.kind];
            const r = nodeRadius(node);
            const dim = isDimmed(node.id);
            const selected = selectedId === node.id;
            const focused = focusId === node.id || highlightSet.has(node.id);
            const hovered = hoverId === node.id;
            const alwaysLabel =
              node.id === 'profile' ||
              node.kind === 'core' ||
              node.kind === 'pillar' ||
              node.kind === 'performance' ||
              node.kind === 'gtm' ||
              node.kind === 'references';
            const showLabel =
              alwaysLabel || activeId === node.id || selected || (node.kind === 'post' && (node.weight ?? 0) >= 0.72);
            const pending = node.pending === true;
            const scale = hovered ? 1.14 : 1;

            return (
              <g
                key={node.id}
                data-node="true"
                transform={`translate(${p.x},${p.y})`}
                style={{
                  opacity: dim ? 0.28 : pending ? 0.55 : 1,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s ease',
                }}
                onPointerEnter={() => setHoverId(node.id)}
                onPointerLeave={() => setHoverId(null)}
                onPointerDown={(e) => {
                  if (node.id === 'profile') return; // profile stays pinned
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  dragRef.current = { id: node.id, startX: e.clientX, startY: e.clientY, moved: false };
                  const sim = simRef.current;
                  const sn = simNodesRef.current.find((n) => n.id === node.id);
                  if (sn) {
                    sn.fx = sn.x;
                    sn.fy = sn.y;
                  }
                  sim?.alphaTarget(0.3).restart();
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.id !== node.id) return;
                  if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) d.moved = true;
                  const gp = toGraphPoint(e.clientX, e.clientY);
                  const sn = simNodesRef.current.find((n) => n.id === node.id);
                  if (sn) {
                    sn.fx = gp.x;
                    sn.fy = gp.y;
                  }
                }}
                onPointerUp={() => {
                  const d = dragRef.current;
                  const sim = simRef.current;
                  sim?.alphaTarget(0);
                  const sn = simNodesRef.current.find((n) => n.id === node.id);
                  if (sn) {
                    sn.fx = null;
                    sn.fy = null;
                  }
                  if (d && !d.moved) onSelect(node);
                  dragRef.current = null;
                }}
              >
                <g style={{ transform: `scale(${scale})`, transition: 'transform 0.16s cubic-bezier(0.34,1.56,0.64,1)' }}>
                  {node.highlight && !selected && (
                    <circle r={r + 3.5} fill="none" stroke="#0F766E" strokeWidth={1.5} strokeOpacity={0.55} />
                  )}
                  {(selected || focused) && (
                    <circle r={r + 6} fill="none" stroke={style.fill} strokeWidth={2} strokeOpacity={0.6} />
                  )}
                  <circle
                    r={r}
                    fill={style.fill}
                    fillOpacity={pending ? 0.35 : 1}
                    stroke="#FBFAF7"
                    strokeWidth={node.id === 'profile' ? 3 : 2}
                    strokeDasharray={pending ? '3 3' : undefined}
                    filter={pending ? undefined : 'url(#brain-node-shadow)'}
                  />
                </g>
                {showLabel && (
                  <text
                    x={0}
                    y={r + 13}
                    textAnchor="middle"
                    className="fill-ink"
                    style={{
                      fontSize: node.id === 'profile' ? 13 : node.kind === 'post' || node.kind === 'story' ? 10.5 : 11.5,
                      fontWeight: node.id === 'profile' ? 700 : alwaysLabel ? 600 : 500,
                      paintOrder: 'stroke',
                      stroke: '#FBFAF7',
                      strokeWidth: 3.5,
                      opacity: dim ? 0.3 : 1,
                      transition: 'opacity 0.15s ease',
                    }}
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
