import { Badge, Card } from '@/components/ui';

/**
 * "One idea. Native everywhere." — an ink source-idea card branching into three
 * platform-native format cards. The format cards use the real ContentOS Card + Badge
 * components so the landing showcases the actual product design system.
 */
const FORMATS: { title: string; badge: string; copy: string }[] = [
  {
    title: 'X thread',
    badge: '7 posts',
    copy: 'Hook → 5 system tactics → CTA. Punchy, line-broken, built to be reply-baited.',
  },
  {
    title: 'LinkedIn',
    badge: 'long-form',
    copy: 'Story-led, first-person, whitespace pacing, a soft authority close.',
  },
  {
    title: 'Video script',
    badge: '45 sec',
    copy: 'Cold-open hook, three beats, teleprompter-ready with on-screen captions.',
  },
];

export default function Distribution() {
  return (
    <section className="mx-auto max-w-[1180px] px-10 pb-10 pt-24">
      <div className="mb-11 max-w-[640px]">
        <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
          05 / DISTRIBUTION
        </span>
        <h2 className="ed-serif mb-[14px] mt-[18px] text-[clamp(30px,3.8vw,50px)] font-normal leading-[1.0] tracking-[-0.025em] text-ink">
          One idea. Native everywhere.
        </h2>
        <p className="m-0 text-[16.5px] leading-[1.6] text-ink2">
          One source thought branches into platform-native formats — each shaped for how
          that feed actually reads. No copy-paste, no lowest-common-denominator post.
        </p>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-[14px] sm:grid-cols-2 lg:grid-cols-[0.7fr_1fr_1fr_1fr]">
        <div className="flex flex-col justify-between rounded-xl bg-ink p-[22px] text-paper">
          <span className="font-mono text-[10px] tracking-[0.08em] text-[rgba(251,250,247,0.6)]">
            SOURCE IDEA
          </span>
          <p className="ed-serif mt-6 text-[22px] leading-[1.25]">
            Consistency is a system, not willpower.
          </p>
        </div>

        {FORMATS.map((f) => (
          <Card key={f.title} className="flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-ink">{f.title}</span>
              <Badge className="bg-bg-tertiary text-text-tertiary">{f.badge}</Badge>
            </div>
            <p className="m-0 mt-4 text-[13px] leading-[1.5] text-ink2">{f.copy}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
