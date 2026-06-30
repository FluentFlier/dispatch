'use client';

import { useRef } from 'react';
import { Plus } from 'lucide-react';
import type { Priority } from '@/lib/constants';
import PillarMultiSelect from '@/components/ui/PillarMultiSelect';

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-coral-light text-accent-primary',
  medium: 'bg-[#FAEEDA] text-[#854F0B]',
  low: 'bg-bg-tertiary text-text-secondary',
};

interface IdeaFormProps {
  value: string;
  pillars: string[];
  weights: Record<string, number>;
  priority: Priority;
  adding: boolean;
  onValueChange: (value: string) => void;
  onPillarsChange: (next: { pillars: string[]; weights: Record<string, number> }) => void;
  onPriorityChange: (priority: Priority) => void;
  onSubmit: () => void;
}

export default function IdeaForm({
  value,
  pillars,
  weights,
  priority,
  adding,
  onValueChange,
  onPillarsChange,
  onPriorityChange,
  onSubmit,
}: IdeaFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="sticky top-0 z-10 bg-bg-secondary border border-border rounded-lg p-[13px_14px] space-y-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Capture an idea..."
          className="flex-1 bg-bg-tertiary border border-border rounded-md px-3 py-2 min-h-[44px] text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors"
        />
        <button
          onClick={onSubmit}
          disabled={adding || !value.trim()}
          className="flex items-center gap-1.5 bg-accent-primary hover:opacity-90 disabled:opacity-40 text-white text-[13px] font-medium px-5 py-[10px] min-h-[44px] rounded-md transition-opacity"
        >
          <Plus size={16} />
          Add
        </button>
      </div>

      {/* Pillar multi-select with weights */}
      <PillarMultiSelect pillars={pillars} weights={weights} onChange={onPillarsChange} />

      {/* Priority pills */}
      <div className="flex gap-1">
        {(['low', 'medium', 'high'] as Priority[]).map((p) => (
          <button
            key={p}
            onClick={() => onPriorityChange(p)}
            className={`px-3 py-2 min-h-[44px] rounded-[3px] text-[10px] font-medium capitalize transition-colors tracking-[0.01em] ${
              priority === p
                ? PRIORITY_STYLES[p]
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
