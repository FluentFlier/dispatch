import { PageHeader } from '@/components/layout/PageHeader';
import { BrainGraphView } from '@/components/brain/BrainGraphView';

export const metadata = {
  title: 'Creator Brain',
};

export default function BrainPage() {
  return (
    <div className="page-shell-wide">
      <PageHeader
        eyebrow="Creator Brain"
        title="Your brain, visualized"
        subtitle="How your voice, content pillars, and top-performing posts connect - the long-term memory behind every AI draft."
      />
      <BrainGraphView />
    </div>
  );
}
