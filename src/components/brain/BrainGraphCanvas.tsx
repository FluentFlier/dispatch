'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BrainGraph, BrainGraphNode, BrainNodeKind } from '@/lib/brain/graph';

interface BrainGraphCanvasProps {
  graph: BrainGraph;
  selectedId: string | null;
  onSelect: (node: BrainGraphNode | null) => void;
}

/** Node fill + radius per kind (editorial palette). */
const KIND_STYLE: Record<BrainNodeKind, { fill: string; radius: number }> = {
  core: { fill: '#2563EB', radius: 15 },
  performance: { fill: '#0F766E', radius: 15 },
  gtm: { fill: '#E8543A', radius: 14 },
  references: { fill: '#8B7BB8', radius: 13 },
  pillar: { fill: '#D4A054', radius: 12 },
  post: { fill: '#5B8FA8', radius: 8 },
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

function nodeRadius(node: BrainGraphNode): number {
  if (node.id === 'profile') return PROFILE_RADIUS;
  return KIND_STYLE[node.kind].radius;
}

/** Static hub-and-spoke layout: profile center, rings by kind. */
function layoutNodes(
  graph: BrainGraph,
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const positions = new Map<string, { x: number; y: number }>();

  const profile = graph.nodes.find((n) => n.id === 'profile');
  if (profile) positions.set('profile', { x: cx, y: cy });

  const rings: { kinds: BrainNodeKind[]; radius: number }[] = [
    { kinds: ['core', 'performance', 'gtm', 'references'], radius: 0.22 },
    { kinds: ['pillar'], radius: 0.34 },
    { kinds: ['post', 'story'], radius: 0.44 },
  ];

  const placed = new Set(['profile']);

  for (const ring of rings) {
    const nodes = graph.nodes.filter((n) => ring.kinds.includes(n.kind) && n.id !== 'profile');
    if (nodes.length === 0) continue;

    const r = Math.min(width, height) * ring.radius;
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      positions.set(node.id, {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      });
      placed.add(node.id);
    });
  }

  // Anything unmatched lands on the outer ring.
  const leftover = graph.nodes.filter((n) => !placed.has(n.id));
  const outerR = Math.min(width, height) * 0.44;
  leftover.forEach((node, i) => {
    const angle = (i / Math.max(1, leftover.length)) * Math.PI * 2;
    positions.set(node.id, {
      x: cx + Math.cos(angle) * outerR,
      y: cy + Math.sin(angle) * outerR,
    });
  });

  return positions;
}

export function BrainGraphCanvas({ graph, selectedId, onSelect }: BrainGraphCanvasProps) {
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

  const positions = useMemo(
    () => layoutNodes(graph, size.w, size.h),
    [graph, size.w, size.h],
  );

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of graph.nodes) map.set(n.id, new Set());
    for (const e of graph.edges) {
      map.get(e.source)?.add(e.target);
      map.get(e.target)?.add(e.source);
    }
    return map;
  }, [graph]);

  const activeId = hoverId ?? selectedId;
  const activeNeighbors = activeId ? neighbors.get(activeId) : null;

  const isDimmed = (id: string): boolean => {
    if (!activeId || id === activeId) return false;
    return !(activeNeighbors?.has(id) ?? false);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-xl border border-hair bg-[radial-gradient(circle_at_center,#FFFFFF_0%,#F4F2EC_100%)]"
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
          return (
            <line
              key={`${e.source}->${e.target}-${i}`}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={isWin ? '#0F766E' : '#171717'}
              strokeOpacity={dim ? 0.06 : isWin ? 0.45 : 0.14}
              strokeWidth={isWin ? 1.5 : 1}
              strokeDasharray={e.kind === 'pillar' ? '4 4' : undefined}
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
          const showLabel = r >= 12 || activeId === node.id || selected;
          return (
            <g
              key={node.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ opacity: dim ? 0.35 : 1, cursor: 'pointer' }}
              onPointerEnter={() => setHoverId(node.id)}
              onPointerLeave={() => setHoverId(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node);
              }}
            >
              {selected && (
                <circle r={r + 6} fill="none" stroke={style.fill} strokeWidth={2} strokeOpacity={0.5} />
              )}
              <circle r={r} fill={style.fill} stroke="#FBFAF7" strokeWidth={node.id === 'profile' ? 3 : 2} />
              {showLabel && (
                <text
                  x={0}
                  y={r + 13}
                  textAnchor="middle"
                  className="fill-ink"
                  style={{
                    fontSize: node.id === 'profile' ? 13 : 11,
                    fontWeight: node.id === 'profile' ? 600 : 500,
                    paintOrder: 'stroke',
                    stroke: '#FBFAF7',
                    strokeWidth: 3,
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
