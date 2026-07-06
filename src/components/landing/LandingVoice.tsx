import { Card } from '@/components/ui/Card';

export default function LandingVoice() {
  return (
    <section id="voice" className="scroll-mt-24 bg-white/40">
      <div className="mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <h2 className="m-0 text-center text-[clamp(24px,3.5vw,36px)] font-semibold tracking-[-0.03em] text-ink">
          Sounds like you.
        </h2>

        <div className="mx-auto mt-10 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
          <Card elevated={false} className="!bg-bg-tertiary/80">
            <p className="m-0 text-[11px] font-medium text-text-tertiary">Generic · 41%</p>
            <p className="m-0 mt-2 text-[14px] italic text-text-tertiary">
              &ldquo;Consistency is key in today&apos;s world…&rdquo;
            </p>
          </Card>
          <Card className="border-accent-primary/20">
            <p className="m-0 text-[11px] font-medium text-accent-primary">Yours · 94%</p>
            <p className="m-0 mt-2 text-[14px] font-medium text-text-primary">
              &ldquo;I built a system instead.&rdquo;
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}
