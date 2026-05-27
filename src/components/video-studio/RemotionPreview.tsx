'use client';

import dynamic from 'next/dynamic';
import type { TemplateId } from './TemplateSelector';
import type { CaptionWord } from './compositions';

interface RemotionPreviewProps {
  videoSrc: string;
  templateId: TemplateId;
  captions?: CaptionWord[];
  hookText?: string;
}

const DEMO_CAPTIONS: CaptionWord[] = [
  { text: 'Hey, check this out', startFrame: 0, endFrame: 45 },
  { text: 'This is pretty cool', startFrame: 50, endFrame: 95 },
  { text: 'Let me show you', startFrame: 100, endFrame: 145 },
];

const containerClass = 'rounded-lg overflow-hidden border border-border';

// Lazy load the Player to avoid SSR issues with Remotion
const LazyPlayer = dynamic(
  () => import('./RemotionPlayerWrapper'),
  { ssr: false, loading: () => <div className="aspect-video bg-bg-tertiary animate-pulse rounded-lg" /> }
);

export default function RemotionPreview({ videoSrc, templateId, captions, hookText }: RemotionPreviewProps) {
  if (!['talking-head-captions', 'hook-content', 'stats-overlay'].includes(templateId)) {
    return (
      <div className="bg-bg-tertiary border border-border rounded-lg p-6 flex items-center justify-center aspect-video">
        <p className="font-body text-[13px] text-text-secondary">
          Preview not available for this template. Use export to render.
        </p>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <LazyPlayer
        templateId={templateId}
        videoSrc={videoSrc}
        captions={captions ?? DEMO_CAPTIONS}
        hookText={hookText ?? 'Your hook goes here...'}
      />
    </div>
  );
}
