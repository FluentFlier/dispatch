import { Card } from '@/components/ui/Card';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.voice;

const TRAITS: [string, string][] = [
  ['Directness', '88%'],
  ['Punchiness', '79%'],
  ['Warmth', '54%'],
];

export default function Voice() {
  return (
    <section id="voice" className="relative scroll-mt-24 overflow-hidden border-y border-hair/60 bg-white/50">
      <LandingGlowOrb tone={theme.glow} position="left" />

      <div className="relative mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-8 px-5 py-12 sm:px-8 sm:py-14 lg:grid-cols-2 lg:gap-10">
        <div>
          <LandingSectionHeader
            tag={theme.tag}
            title="Sounds like you."
            subtitle="Voice QA on every draft. Not ChatGPT tone."
            accent={theme.accent}
            className="max-w-md"
          />
          <div className="mt-6 flex max-w-sm flex-col gap-3">
            {TRAITS.map(([trait, pct]) => (
              <div key={trait}>
                <div className="mb-1 flex justify-between text-[13px] text-ink2">
                  <span>{trait}</span>
                  <span className="font-mono text-[11px] text-ink3">{pct}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hair">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal to-blue transition-all duration-700"
                    style={{ width: pct }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-bg-secondary/90 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)] backdrop-blur-md">
          <Card elevated={false} className="rounded-none border-0 border-b border-border !bg-bg-tertiary/50">
            <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
              Generic · 41%
            </p>
            <p className="m-0 mt-2 text-[15px] italic text-text-tertiary">
              &ldquo;In today&apos;s fast-paced world, consistency is key…&rdquo;
            </p>
          </Card>
          <div className="border-b border-border bg-gradient-to-r from-teal/10 to-blue/5 py-2 text-center text-[11px] font-medium text-teal">
            Your fingerprint
          </div>
          <Card elevated={false} className="rounded-none border-0 !bg-gradient-to-br from-teal/5 to-bg-secondary">
            <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-teal">
              Your voice · 94%
            </p>
            <p className="m-0 mt-2 text-[17px] font-medium text-text-primary">
              &ldquo;I built a system instead of chasing consistency.&rdquo;
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}
