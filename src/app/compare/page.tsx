import type { Metadata } from 'next';
import Link from 'next/link';
import JsonLd from '@/components/seo/JsonLd';
import { PublicHero, PublicPage, Section } from '@/components/marketing/PublicPage';
import { PRODUCT_NAME } from '@/lib/brand';
import { absoluteUrl, findSeoPage, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(findSeoPage('/compare'));

const rows = [
  ['Drafts in your voice', 'Built around imported voice, stories, and reusable context', 'Usually generic prompts or blank composer'],
  ['Publishing workflow', 'Calendar, scheduling, and status tracking in the same loop', 'Often separated from writing or analytics'],
  ['Engagement follow-up', 'Replies and warm contacts become part of daily work', 'Usually stops after publishing'],
  ['Learning loop', 'Performance informs future hooks, pillars, and topics', 'Analytics are often read-only reports'],
  ['Best fit', 'Creators and teams who connect content to pipeline', 'Teams that only need a queue or simple scheduling'],
];

export default function ComparePage(): JSX.Element {
  return (
    <PublicPage>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: `Compare ${PRODUCT_NAME}`,
          url: absoluteUrl('/compare'),
          description:
            'Compare Content OS with social schedulers, AI writing tools, and spreadsheets for creator-led content operations.',
        }}
      />
      <PublicHero
        eyebrow="Compare"
        title="More than a scheduler. More focused than a generic writing tool."
        description="Content OS is for people who need content, engagement, and pipeline signals to reinforce each other instead of living in separate tabs."
      />
      <Section title="Content OS compared with a typical stack">
        <div className="overflow-hidden rounded-card border border-hair bg-white">
          <div className="grid grid-cols-[0.8fr_1.2fr_1.2fr] border-b border-hair bg-paper2 px-4 py-3 text-sm font-semibold text-ink">
            <span>Workflow</span>
            <span>{PRODUCT_NAME}</span>
            <span>Typical scheduler or AI writer</span>
          </div>
          {rows.map(([workflow, contentOs, typical]) => (
            <div key={workflow} className="grid grid-cols-1 gap-3 border-b border-hair px-4 py-4 text-sm last:border-b-0 md:grid-cols-[0.8fr_1.2fr_1.2fr]">
              <strong className="text-ink">{workflow}</strong>
              <span className="leading-6 text-ink2">{contentOs}</span>
              <span className="leading-6 text-ink2">{typical}</span>
            </div>
          ))}
        </div>
      </Section>
      <section className="border-t border-hair bg-paper2">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-12 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-serif text-[32px] font-normal text-ink">See the connected workflow</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink2">
              The easiest way to compare is to watch a post move from idea to reply to next action.
            </p>
          </div>
          <Link href="/book-demo" className="btn-primary">
            Book a demo
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}
