'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BrainGraph, BrainGraphNode, BrainNodeKind } from '@/lib/brain/graph';

interface BrainGraphCanvasProps {
  graph: BrainGraph;
  selectedId: string | null;
  onSelect: (node: BrainGraphNode | null) => void;
  /** Externally highlight a node (e.g. from a decision card). */
  focusId?: string | null;
}

const KIND_STYLE: Record<BrainNodeKind, { fill: string; radius: number }> = {
  core: { fill: '#2563EB', radius: 13 },
  performance: { fill: '#0F766E', radius: 14 },
  gtm: { fill: '#E8543A', radius: 13 },
  references: { fill: '#8B7BB8', radius: 12 },
  pillar: { fill: '#171717', radius: 12 },
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

interface Pt {
  x: number;
  y: number;
}

function forceLayout(graph: BrainGraph): Map<string, Pt> {
  const pos = new Map<string, Pt>();
  const nodes = graph.nodes;
  const n = nodes.length;

  nodes.forEach((node, i) => {
    if (node.id === 'profile') {
      pos.set(node.id, { x: 0, y: 0 });
      return;
    }
    const angle = i * GOLDEN_ANGLE;
    const radius = 0.12 + 0.62 * Math.sqrt(i / Math.max(1, n));
    pos.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });

  if (n <= 1) return pos;

  const k = Math.max(0.26, 0.85 * Math.sqrt(4 / n));
  const idealLength = (a: BrainGraphNode, b: BrainGraphNode): number => {
    const kinds = new Set([a.kind, b.kind]);
    const involvesLeaf = kinds.has('post') || kinds.has('story');
    if (kinds.has('pillar') && involvesLeaf) return k * 0.55;
    if (involvesLeaf) return k * 0.7;
    if (kinds.has('pillar')) return k * 1.15;
    return k;
  };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .map((e) => {
      const source = nodeById.get(e.source);
      const target = nodeById.get(e.target);
      return source && target ? { source, target } : null;
    })
    .filter((e): e is { source: BrainGraphNode; target: BrainGraphNode } => e !== null);

  const ITERATIONS = 260;
  let temp = 0.32;
  const disp = new Map<string, Pt>();

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const node of nodes) disp.set(node.id, { x: 0, y: 0 });

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const pa = pos.get(a.id)!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        const pb = pos.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-4) {
          dx = (Math.random() - 0.5) * 1e-3;
          dy = (Math.random() - 0.5) * 1e-3;
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        const da = disp.get(a.id)!;
        const db = disp.get(b.id)!;
        da.x += (dx / dist) * force;
        da.y += (dy / dist) * force;
        db.x -= (dx / dist) * force;
        db.y -= (dy / dist) * force;
      }
    }

    for (const { source, target } of edges) {
      const ps = pos.get(source.id)!;
      const pt = pos.get(target.id)!;
      const dx = ps.x - pt.x;
      const dy = ps.y - pt.y;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const L = idealLength(source, target);
      const force = (dist * dist) / k / L;
      const ux = dx / dist;
      const uy = dy / dist;
      const ds = disp.get(source.id)!;
      const dt = disp.get(target.id)!;
      ds.x -= ux * force;
      ds.y -= uy * force;
      dt.x += ux * force;
      dt.y += uy * force;
    }

    for (const node of nodes) {
      if (node.id === 'profile') continue;
      const d = disp.get(node.id)!;
      const p = pos.get(node.id)!;
      const len = Math.hypot(d.x, d.y) || 1e-4;
      p.x += (d.x / len) * Math.min(len, temp);
      p.y += (d.y / len) * Math.min(len, temp);
    }

    temp *= 0.965;
  }

  return pos;
}

export function BrainGraphCanvas({ graph, selectedId, onSelect, focusId }: BrainGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => forceLayout(graph), [graph]);

  const positions = useMemo(() => {
    const pad = 56;
    const out = new Map<string, Pt>();
    if (layout.size === 0) return out;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    layout.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min((size.w - pad * 2) / spanX, (size.h - pad * 2) / spanY);
    const offsetX = (size.w - spanX * scale) / 2;
    const offsetY = (size.h - spanY * scale) / 2;

    layout.forEach((p, id) => {
      out.set(id, {
        x: offsetX + (p.x - minX) * scale,
        y: offsetY + (p.y - minY) * scale,
      });
    });
    return out;
  }, [layout, size.w, size.h]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of graph.nodes) map.set(node.id, new Set());
    for (const e of graph.edges) {
      map.get(e.source)?.add(e.target);
      map.get(e.target)?.add(e.source);
    }
    return map;
  }, [graph]);

  const activeId = hoverId ?? selectedId ?? focusId;
  const activeNeighbors = activeId ? neighbors.get(activeId) : null;

  const isDimmed = (id: string): boolean => {
    if (!activeId || id === activeId) return false;
    return !(activeNeighbors?.has(id) ?? false);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-surface border border-hair bg-[radial-gradient(120%_120%_at_50%_0%,#FFFFFF_0%,#F7F5EF_60%,#F1EEE6_100%)]"
    >
      <svg
        width={size.w}
        height={size.h}
        className="block select-none"
        onClick={() => onSelect(null)}
      >
        {graph.edges.map((e, i) => {
          const s = positions.get(e.source);
          const t = positions.get(e.target);
          if (!s || !t) return null;
          const dim = isDimmed(e.source) && isDimmed(e.target);
          const isWin = e.kind === 'win';
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const nx = -dy;
          const ny = dx;
          const nlen = Math.hypot(nx, ny) || 1;
          const bend = Math.min(28, Math.hypot(dx, dy) * 0.12);
          const cx = mx + (nx / nlen) * bend;
          const cy = my + (ny / nlen) * bend;
          return (
            <path
              key={`${e.source}->${e.target}-${i}`}
              d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
              fill="none"
              stroke={isWin ? '#0F766E' : '#171717'}
              strokeOpacity={dim ? 0.05 : isWin ? 0.5 : 0.12}
              strokeWidth={isWin ? 1.75 : 1}
              strokeDasharray={e.kind === 'pillar' ? '4 5' : undefined}
              strokeLinecap="round"
            />
          );
        })}

        {graph.nodes.map((node) => {
          const p = positions.get(node.id);
          if (!p) return null;
          const style = KIND_STYLE[node.kind];
          const r = nodeRadius(node);
          const dim = isDimmed(node.id);
          const selected = selectedId === node.id;
          const focused = focusId === node.id;
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

          return (
            <g
              key={node.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ opacity: dim ? 0.3 : pending ? 0.55 : 1, cursor: 'pointer', transition: 'opacity 0.15s ease' }}
              onPointerEnter={() => setHoverId(node.id)}
              onPointerLeave={() => setHoverId(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node);
              }}
            >
              {node.highlight && !selected && (
                <circle r={r + 3.5} fill="none" stroke="#0F766E" strokeWidth={1.5} strokeOpacity={0.55} />
              )}
              {(selected || focused) && (
                <circle r={r + 6} fill="none" stroke={style.fill} strokeWidth={2} strokeOpacity={0.55} />
              )}
              <circle
                r={r}
                fill={style.fill}
                fillOpacity={pending ? 0.35 : 1}
                stroke="#FBFAF7"
                strokeWidth={node.id === 'profile' ? 3 : 2}
                strokeDasharray={pending ? '3 3' : undefined}
              />
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
                  }}
                >
                  {node.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
