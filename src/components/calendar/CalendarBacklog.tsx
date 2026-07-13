'use client';

import { Sparkles } from 'lucide-react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import type { Post } from '@/lib/types';
import PillarDot from '@/components/PillarDot';
import StatusBadge from '@/components/ui/StatusBadge';

interface CalendarBacklogProps {
  backlog: Post[];
  selectedPostId: string | null;
  onPostClick: (post: Post) => void;
  onFillWeek: () => void;
  fillDisabled: boolean;
}

export default function CalendarBacklog({
  backlog,
  selectedPostId,
  onPostClick,
  onFillWeek,
  fillDisabled,
}: CalendarBacklogProps) {
  return (
    <div className="lg:w-[280px] lg:border-l lg:border-hair lg:pl-4 shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-label">
          Unscheduled
        </h2>
        <button
          onClick={onFillWeek}
          disabled={fillDisabled}
          className="flex items-center gap-1.5 bg-accent-primary text-white text-[11px] font-medium px-2.5 py-1.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Fill This Week
        </button>
      </div>

      {backlog.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No unscheduled posts.</p>
      ) : (
        <Droppable droppableId="backlog" isDropDisabled>
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="space-y-2 max-h-[60vh] overflow-y-auto pr-1"
            >
              {backlog.map((p, index) => (
                <Draggable key={p.id} draggableId={p.id} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      onClick={() => onPostClick(p)}
                      className={`rounded-lg border p-2.5 cursor-grab transition-colors ${
                        dragSnapshot.isDragging
                          ? 'border-accent-primary bg-coral-light shadow-lg rotate-2'
                          : selectedPostId === p.id
                          ? 'border-accent-primary bg-coral-light'
                          : 'border-border bg-bg-secondary hover:border-border-hover'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <PillarDot pillar={p.pillar} />
                        <span className="text-[13px] text-text-primary font-medium truncate">
                          {p.title}
                        </span>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}
    </div>
  );
}
