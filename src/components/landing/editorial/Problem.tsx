import { ArrowRight, X } from 'lucide-react';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import { PRODUCT_NAME } from './brand';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.problem;

const ROWS: [string, string][] = [
  ['Ideas everywhere', 'One Story Bank'],
  ['Generic AI drafts', 'Voice scored to you'],
  ['Scheduling elsewhere', 'One calendar'],
  ['Comments die', 'Replies become posts'],
];

export default function Problem() {
  return (
    <section id="problem" className="relative scroll-mt-24 overflow-hidden border-t border-hair/60 bg-white/50">
      <LandingGlowOrb tone={theme.glow} position="right" />
      <div className="relative mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <LandingSectionHeader
            tag={theme.tag}
            title="Scattered tools leak signal."
            subtitle={`${PRODUCT_NAME} keeps the full loop in one place.`}
            accent={theme.accent}
          />

          <div className="overflow-hidden rounded-2xl border border-hair bg-white/90 shadow-[0_20px_50px_-30px_rgba(23,23,23,0.18)] backdrop-blur-sm">
            <div className="hidden grid-cols-[1fr_32px_1fr] gap-3 border-b border-hair bg-paper2/40 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-ink3 sm:grid">
              <span>Today</span>
              <span />
              <span className="text-blue">{PRODUCT_NAME}</span>
            </div>
            {ROWS.map(([before, after], i) => (
              <div
                key={before}
                className={`px-4 py-3.5 ${i < ROWS.length - 1 ? 'border-b border-hair' : ''}`}
              >
                <div className="flex flex-col gap-2 sm:hidden">
                  <span className="flex items-center gap-2 text-[14px] text-ink3">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-flame/10 text-flame">
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                    {before}
                  </span>
                  <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal">
                      <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
                    </span>
                    {after}
                  </span>
                </div>
                <div className="hidden grid-cols-[1fr_32px_1fr] items-center gap-3 sm:grid">
                  <span className="flex items-center gap-2.5 text-[14px] text-ink3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-flame/10 text-flame">
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    {before}
                  </span>
                  <span className="text-center text-ink3/50">→</span>
                  <span className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal">
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    {after}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
