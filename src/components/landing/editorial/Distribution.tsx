import { Badge, Card } from '@/components/ui';

const FORMATS: { title: string; badge: string }[] = [
  { title: 'X thread', badge: '7 posts' },
  { title: 'LinkedIn', badge: 'long-form' },
  { title: 'IG carousel', badge: '5 slides' },
];

export default function Distribution() {
  return (
    <section
      id="distribution"
      className="scroll-mt-24 mx-auto max-w-[1180px] px-5 pb-10 pt-14 sm:px-10 sm:pt-20"
    >
      <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">05 / DISTRIBUTION</span>
      <h2 className="ed-serif mb-8 mt-4 text-[clamp(28px,3.6vw,44px)] font-normal leading-[1.02] tracking-[-0.025em] text-ink">
        One idea. Native everywhere.
      </h2>

      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-[0.65fr_1fr_1fr_1fr]">
        <div className="flex flex-col justify-end rounded-xl bg-ink p-5 text-paper">
          <span className="font-mono text-[10px] text-paper/60">SOURCE</span>
          <p className="ed-serif m-0 mt-3 text-[20px] leading-tight">
            Your calendar is full of ideas.
          </p>
        </div>
        {FORMATS.map((f) => (
          <Card key={f.title} className="flex items-center justify-between py-4">
            <span className="text-[14px] font-semibold text-ink">{f.title}</span>
            <Badge className="bg-bg-tertiary text-text-tertiary">{f.badge}</Badge>
          </Card>
        ))}
      </div>
    </section>
  );
}
