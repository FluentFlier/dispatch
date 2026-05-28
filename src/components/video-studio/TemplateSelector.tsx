'use client';

import { useState } from 'react';
import {
  MessageSquare,
  Zap,
  Film,
  BarChart3,
  Columns2,
  Check,
} from 'lucide-react';

export type TemplateId =
  | 'talking-head-captions'
  | 'hook-content'
  | 'story-highlights'
  | 'stats-overlay'
  | 'before-after';

interface Template {
  id: TemplateId;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const TEMPLATES: Template[] = [
  {
    id: 'talking-head-captions',
    title: 'Talking Head with Captions',
    description: 'Auto-generated captions overlaid on your talking head video with animated styling.',
    icon: <MessageSquare className="w-6 h-6" />,
  },
  {
    id: 'hook-content',
    title: 'Hook + Content',
    description: 'Eye-catching animated text intro followed by your main video content.',
    icon: <Zap className="w-6 h-6" />,
  },
  {
    id: 'story-highlights',
    title: 'Story Highlights',
    description: 'Compile multiple clips into a polished story highlights reel.',
    icon: <Film className="w-6 h-6" />,
  },
  {
    id: 'stats-overlay',
    title: 'Stats Overlay',
    description: 'Animated statistics and data points overlaid on your video.',
    icon: <BarChart3 className="w-6 h-6" />,
  },
  {
    id: 'before-after',
    title: 'Before/After',
    description: 'Split-screen comparison with smooth transition between two clips.',
    icon: <Columns2 className="w-6 h-6" />,
  },
];

interface TemplateSelectorProps {
  selected?: TemplateId;
  onSelect?: (id: TemplateId) => void;
  hasVideo?: boolean;
}

export default function TemplateSelector({ selected, onSelect, hasVideo }: TemplateSelectorProps) {
  return (
    <div className="space-y-3">
      <h3 className="font-heading text-[15px] font-semibold text-text-primary">
        Templates
      </h3>
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${!hasVideo ? 'opacity-50 pointer-events-none' : ''}`}>
        {TEMPLATES.map((template) => {
          const isSelected = selected === template.id;
          return (
            <button
              key={template.id}
              onClick={() => onSelect?.(template.id)}
              className={`text-left rounded-lg p-4 border transition-all duration-100 ${
                isSelected
                  ? 'bg-coral-light border-accent-primary/40'
                  : 'bg-bg-tertiary border-border hover:border-border-hover'
              }`}
            >
              <div className={`flex items-center justify-center w-full h-24 rounded-md mb-3 ${
                isSelected ? 'bg-accent-primary/20 text-accent-primary' : 'bg-bg-tertiary text-text-secondary'
              }`}>
                {isSelected ? <Check className="w-6 h-6" /> : template.icon}
              </div>
              <p className={`font-body text-[13px] font-medium ${isSelected ? 'text-accent-primary' : 'text-text-primary'}`}>
                {template.title}
              </p>
              <p className="font-body text-[11px] text-text-secondary mt-1 line-clamp-2">
                {template.description}
              </p>
            </button>
          );
        })}
      </div>
      {!hasVideo && (
        <p className="font-body text-[11px] text-text-secondary">
          Upload a video to enable templates.
        </p>
      )}
    </div>
  );
}
