import type { Metadata } from 'next';
import JsonLd from '@/components/seo/JsonLd';
import { PublicHero, PublicPage, Section } from '@/components/marketing/PublicPage';
import { PRODUCT_NAME } from '@/lib/brand';
import { absoluteUrl, findSeoPage, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(findSeoPage('/templates'));

const templates = [
  {
    title: 'Founder story post',
    intent: 'Build trust',
    structure: 'Moment -> tension -> lesson -> practical takeaway -> soft invitation.',
  },
  {
    title: 'LinkedIn launch post',
    intent: 'Announce without sounding generic',
    structure: 'Problem -> what changed -> who it helps -> proof -> direct CTA.',
  },
  {
    title: 'Contrarian hook',
    intent: 'Earn attention',
    structure: 'Common belief -> disagreement -> reason -> example -> useful reframe.',
  },
  {
    title: 'Comment reply follow-up',
    intent: 'Turn engagement into conversation',
    structure: 'Acknowledge -> add specific value -> ask one natural next question.',
  },
  {
    title: 'Weekly content calendar',
    intent: 'Stay consistent',
    structure: 'Point of view, customer lesson, proof, tactical how-to, conversation starter.',
  },
  {
    title: 'Sales signal post',
    intent: 'Attract qualified buyers',
    structure: 'Trigger event -> risk or opportunity -> diagnostic signs -> next step.',
  },
];

export default function TemplatesPage(): JSX.Element {
  return (
    <PublicPage>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: `${PRODUCT_NAME} content templates`,
          url: absoluteUrl('/templates'),
          hasPart: templates.map((template) => ({
            '@type': 'CreativeWork',
            name: template.title,
            description: template.structure,
          })),
        }}
      />
      <PublicHero
        eyebrow="Templates"
        title="Content templates for posts that start real conversations."
        description="Use these structures for LinkedIn, X, launches, replies, and weekly planning. Content OS turns the same patterns into a living drafting system."
      />
      <Section
        title="Reusable starting points"
        intro="Good templates do not replace your voice. They give your ideas enough shape to get published and enough specificity to be useful."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <article key={template.title} className="rounded-card border border-hair bg-white p-5">
              <p className="font-mono text-[12px] text-teal">{template.intent}</p>
              <h2 className="mt-3 text-[20px] font-semibold text-ink">{template.title}</h2>
              <p className="mt-3 text-sm leading-6 text-ink2">{template.structure}</p>
            </article>
          ))}
        </div>
      </Section>
    </PublicPage>
  );
}
