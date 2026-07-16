import type { Metadata } from 'next';
import JsonLd from '@/components/seo/JsonLd';
import { FeatureGrid, PublicHero, PublicPage, Section } from '@/components/marketing/PublicPage';
import { PRODUCT_NAME } from '@/lib/brand';
import { absoluteUrl, findSeoPage, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(findSeoPage('/features'));

const features = [
  {
    title: 'Voice-aware drafting',
    description:
      'Import your best posts, capture your opinions, and draft content that sounds like a sharper version of you.',
  },
  {
    title: 'Publishing calendar',
    description:
      'Plan LinkedIn and X posts, schedule launches, and keep your week of content visible before anything ships.',
  },
  {
    title: 'Engagement inbox',
    description:
      'Turn comments and replies into a daily response queue so good conversations do not disappear after publishing.',
  },
  {
    title: 'Lead signals',
    description:
      'Track warm prospects, buying signals, and follow-up moments from the same system that creates the content.',
  },
  {
    title: 'Performance loop',
    description:
      'Use engagement and reply data to shape the next post instead of treating analytics as a separate dashboard.',
  },
  {
    title: 'Creator brain',
    description:
      'Centralize stories, offers, audience notes, and recurring angles so every draft starts with context.',
  },
];

const workflow = [
  'Capture ideas and useful moments from your week.',
  'Draft posts with voice, offer, and audience context.',
  'Schedule publishing across LinkedIn and X.',
  'Reply to comments and warm contacts from one queue.',
  'Feed performance back into future hooks and angles.',
];

export default function FeaturesPage(): JSX.Element {
  return (
    <PublicPage>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: PRODUCT_NAME,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: absoluteUrl('/features'),
          featureList: features.map((feature) => feature.title),
        }}
      />
      <PublicHero
        eyebrow="Features"
        title="One operating system for content that creates conversations."
        description="Content OS connects drafting, scheduling, replies, leads, and learning so publishing becomes a repeatable business workflow."
      />
      <Section
        title="Everything feeds the next thing"
        intro="Most content stacks split writing, scheduling, engagement, and sales notes across tools. Content OS keeps those signals connected."
      >
        <FeatureGrid items={features} />
      </Section>
      <Section title="The daily loop">
        <div className="grid gap-3 md:grid-cols-5">
          {workflow.map((step, index) => (
            <div key={step} className="rounded-card border border-hair bg-paper2 p-4">
              <p className="font-mono text-[12px] text-teal">0{index + 1}</p>
              <p className="mt-3 text-sm font-medium leading-6 text-ink">{step}</p>
            </div>
          ))}
        </div>
      </Section>
    </PublicPage>
  );
}
