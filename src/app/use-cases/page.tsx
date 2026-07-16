import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/seo/JsonLd';
import { FeatureGrid, PublicHero, PublicPage, Section } from '@/components/marketing/PublicPage';
import { PRODUCT_NAME } from '@/lib/brand';
import { absoluteUrl, findSeoPage, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(findSeoPage('/use-cases'));

const useCases = [
  {
    title: 'Founders building trust',
    description:
      'Turn customer calls, product lessons, and market opinions into consistent founder-led content that supports pipeline.',
  },
  {
    title: 'Consultants and experts',
    description:
      'Package repeatable advice, client patterns, and sharp points of view into posts that create qualified conversations.',
  },
  {
    title: 'Creator-led teams',
    description:
      'Coordinate ideas, drafts, approvals, publishing, and replies without losing the human voice of the account.',
  },
  {
    title: 'B2B social selling',
    description:
      'Use content engagement as a source of warm follow-up moments instead of cold outreach from a blank slate.',
  },
  {
    title: 'Launch campaigns',
    description:
      'Plan announcement posts, proof posts, founder notes, and reply follow-up around a product or offer launch.',
  },
  {
    title: 'Personal brand systems',
    description:
      'Keep stories, pillars, examples, and post performance in one place so publishing does not restart every week.',
  },
];

export default function UseCasesPage(): JSX.Element {
  return (
    <PublicPage>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: `${PRODUCT_NAME} use cases`,
          url: absoluteUrl('/use-cases'),
          hasPart: useCases.map((item) => ({ '@type': 'WebPage', name: item.title })),
        }}
      />
      <PublicHero
        eyebrow="Use cases"
        title="For people whose content has to create business outcomes."
        description="Content OS is built for founders, consultants, creators, and small teams that need posts, replies, and follow-up to work as one system."
      />
      <Section
        title="High-intent workflows"
        intro="The strongest use cases share one pattern: ideas become posts, posts become conversations, and conversations become useful next actions."
      >
        <FeatureGrid items={useCases} />
      </Section>
      <section className="border-t border-hair bg-paper2">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-12 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-serif text-[32px] font-normal text-ink">Need the full workflow?</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink2">
              Start with templates, then connect the publishing and engagement loop when you are ready.
            </p>
          </div>
          <Link href="/templates" className="btn-primary">
            Browse templates
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}
