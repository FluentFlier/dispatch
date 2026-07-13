'use client';

import { ArrowRightCircle, RefreshCw, Trash2, X } from 'lucide-react';
import type { StoryBankEntry } from '@/lib/types';
import { usePillars } from '@/hooks/usePillars';

function StoryPillarBadge({ pillar }: { pillar: string }) {
  const { getColor, getLabel } = usePillars();
  const color = getColor(pillar);
  const label = getLabel(pillar);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium px-[7px] py-[2px] rounded-[3px] tracking-[0.01em]"
      style={{
        backgroundColor: `${color}20`,
        color: color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

interface StoryCardProps {
  story: StoryBankEntry;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onConvert: () => void;
  onRemine: () => void;
  onDelete: () => void;
  converting: boolean;
  remining: boolean;
  deleting: boolean;
}

export default function StoryCard({
  story,
  isExpanded,
  onToggleExpand,
  onConvert,
  onRemine,
  onDelete,
  converting,
  remining,
  deleting,
}: StoryCardProps) {
  return (
    <div
      className={`bg-bg-secondary border border-border rounded-lg transition-all ${
        story.used ? 'opacity-75' : ''
      } ${
        isExpanded
          ? 'col-span-1 md:col-span-2 lg:col-span-3'
          : 'hover:border-border-hover cursor-pointer'
      }`}
    >
      {/* Card header */}
      <div className="p-[13px_14px]" onClick={onToggleExpand}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-[15px] text-ink2 leading-[1.5]">
            {isExpanded
              ? story.raw_memory
              : story.raw_memory.length > 100
              ? story.raw_memory.slice(0, 100) + '...'
              : story.raw_memory}
          </p>
          {isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="shrink-0 p-1 text-text-secondary hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {story.mined_angle && (
          <p className="text-[13px] font-medium text-accent-primary mb-2">
            {story.mined_angle}
          </p>
        )}

        <div className="flex items-center gap-[6px]">
          {story.pillar && <StoryPillarBadge pillar={story.pillar} />}
          <span
            className={`text-[10px] px-[7px] py-[2px] rounded-[3px] tracking-[0.08em] ${
              story.used
                ? 'bg-[rgba(16,185,129,0.15)] text-[#3B6D11]'
                : 'bg-bg-tertiary text-ink3'
            }`}
          >
            {story.used ? 'Used' : 'Unused'}
          </span>
        </div>
      </div>

      {/* Expanded section */}
      {isExpanded && (
        <div className="border-t border-hair px-[14px] py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="section-label mb-1">
                Raw Memory
              </h4>
              <p className="text-[15px] text-ink leading-[1.5]">
                {story.raw_memory}
              </p>
            </div>
            <div>
              <h4 className="section-label mb-1">
                Mined Angle
              </h4>
              <p className="text-[13px] text-accent-primary font-medium">
                {story.mined_angle || 'Not yet mined'}
              </p>
            </div>
            <div>
              <h4 className="section-label mb-1">
                Mined Hook
              </h4>
              <p className="text-[13px] text-text-primary">
                {story.mined_hook || 'Not yet mined'}
              </p>
            </div>
            <div>
              <h4 className="section-label mb-1">
                Caption Line
              </h4>
              <p className="text-[13px] text-text-primary">
                {story.mined_caption_line || 'Not yet mined'}
              </p>
            </div>
          </div>

          {story.mined_script && (
            <div>
              <h4 className="section-label mb-1">
                Mined Script
              </h4>
              <div className="bg-bg-tertiary border border-border rounded-lg p-3">
                {story.mined_script.split('\n').map((line, i) => (
                  <p
                    key={i}
                    className="text-[13px] text-text-primary leading-[1.55]"
                  >
                    {line || '\u00A0'}
                  </p>
                ))}
              </div>
            </div>
          )}

          {story.pillar && (
            <div>
              <h4 className="section-label mb-1">
                Pillar
              </h4>
              <StoryPillarBadge pillar={story.pillar} />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-hair">
            <button
              onClick={onConvert}
              disabled={converting || story.used}
              className="flex items-center gap-1.5 bg-accent-primary text-white text-[13px] font-medium px-5 py-[10px] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRightCircle className="w-4 h-4" />
              {converting
                ? 'Converting...'
                : story.used
                ? 'Already Converted'
                : 'Convert to Post'}
            </button>
            <button
              onClick={onRemine}
              disabled={remining}
              className="flex items-center gap-1.5 bg-bg-tertiary border border-border text-text-primary text-[13px] font-medium px-[14px] py-[7px] rounded-md hover:border-border-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw
                className={`w-4 h-4 ${remining ? 'animate-spin' : ''}`}
              />
              {remining ? 'Re-mining...' : 'Re-mine'}
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 text-accent-primary hover:opacity-80 text-[13px] font-medium px-[14px] py-[7px] rounded-md border border-transparent hover:border-accent-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            >
              <Trash2 className="w-4 h-4" />
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
