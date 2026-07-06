import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import LandingPlatformChips from '../LandingPlatformChips';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.distribution;

const FORMATS: { title: string; badge: string }[] = [
  { title: 'LinkedIn', badge: 'long-form' },
  { title: 'X thread', badge: '7 posts' },
];

export default function Distribution() {
  return (
    <section
      id="distribution"
      className="relative scroll-mt-24 overflow-hidden border-t border-hair/60 bg-white/40"
    >
      <LandingGlowOrb tone={theme.glow} position="right" />
      <div className="relative mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <LandingSectionHeader
          tag={theme.tag}
          title="One idea. Two channels."
          subtitle="Repurpose once. Publish to LinkedIn and X."
          accent={theme.accent}
        />

        <div className="mt-6">
          <LandingPlatformChips />
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:gap-4">
          <div className="relative flex flex-col justify-end overflow-hidden rounded-2xl bg-ink p-5 text-paper shadow-[0_24px_60px_-24px_rgba(23,23,23,0.5)] sm:min-h-[140px]">
            <Image
              src="/landing/glow.png"
              alt=""
              width={200}
              height={200}
              className="pointer-events-none absolute -right-6 -top-6 opacity-40"
              aria-hidden
            />
            <span className="relative text-[10px] font-medium uppercase tracking-wide text-paper/60">
              Source
            </span>
            <p className="relative m-0 mt-2 text-[18px] font-medium leading-snug">
              Your calendar is full of ideas.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-[12px] font-medium text-ink3 sm:hidden">
            <ArrowRight className="h-4 w-4" />
            Repurpose
            <ArrowRight className="h-4 w-4" />
          </div>

          <div className="hidden items-stretch gap-3 sm:grid sm:grid-cols-[auto_1fr_auto_1fr]">
            <div className="flex items-center text-ink3">
              <ArrowRight className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="flex items-center justify-center">
              <div className="rounded-full border border-hair bg-white/90 px-4 py-2 text-[12px] font-medium text-ink2 shadow-sm backdrop-blur-sm">
                Repurpose
              </div>
            </div>
            <div className="flex items-center text-ink3">
              <ArrowRight className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col justify-center gap-3">
              {FORMATS.map((f) => (
                <Card key={f.title} className="flex items-center justify-between py-3.5">
                  <span className="text-[14px] font-medium text-text-primary">{f.title}</span>
                  <Badge className="bg-bg-tertiary text-text-tertiary">{f.badge}</Badge>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {FORMATS.map((f) => (
              <Card key={f.title} className="flex items-center justify-between py-3.5">
                <span className="text-[14px] font-medium text-text-primary">{f.title}</span>
                <Badge className="bg-bg-tertiary text-text-tertiary">{f.badge}</Badge>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
