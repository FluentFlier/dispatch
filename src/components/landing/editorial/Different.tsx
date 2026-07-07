import { ArrowRight, X } from 'lucide-react';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import { PRODUCT_NAME } from './brand';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.different;

const ROWS: [string, string][] = [
  ['Writes from cold prompts', 'Learns from your posts and emails'],
  ['No memory between posts', 'Creator Brain compounds'],
  ['Analytics as reports', 'Analytics as training signal'],
  ['Voice drifts', 'Persistent voice fingerprint'],
  ['One platform at a time', 'Native LinkedIn and X'],
];

const ALSO: { label: string; accent: string }[] = [
  { label: 'Video Studio', accent: '#8B7BB8' },
  { label: 'Voice Lab', accent: '#0F766E' },
  { label: 'Story Bank', accent: '#2563EB' },
  { label: 'Warm contacts', accent: '#E8543A' },
  { label: 'Lead signals', accent: '#D4A054' },
];

export default function Different() {
  return (
    <section id="different" className="relative scroll-mt-24 overflow-hidden border-t border-hair/60 bg-white/50">
      <LandingGlowOrb tone={theme.glow} position="right" />
      <div className="relative mx-auto max-w-[1100px] px-5 py-12 sm:px-8 sm:py-14">
        <LandingSectionHeader
          tag={theme.tag}
          title="Not another caption generator."
          subtitle="A command center, not a prompt box."
          accent={theme.accent}
        />

        <div className="mt-8 overflow-hidden rounded-2xl border border-hair bg-white/90 shadow-[0_20px_50px_-30px_rgba(23,23,23,0.15)]">
          <div className="hidden grid-cols-2 gap-4 border-b border-hair bg-paper2/30 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-ink3 sm:grid">
            <span>Generic scheduler</span>
            <span className="text-blue">{PRODUCT_NAME}</span>
          </div>
          {ROWS.map(([before, after], i) => (
            <div
              key={before}
              className={`px-4 py-3.5 ${i < ROWS.length - 1 ? 'border-b border-hair' : ''}`}
            >
              <div className="flex flex-col gap-2 sm:hidden">
                <span className="flex items-center gap-2 text-[14px] text-ink3">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink/5 text-ink3">
                    <X className="h-3 w-3" />
                  </span>
                  {before}
                </span>
                <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue/10 text-blue">
                    <ArrowRight className="h-3 w-3" />
                  </span>
                  {after}
                </span>
              </div>
              <div className="hidden grid-cols-2 gap-4 sm:grid">
                <span className="flex items-center gap-2.5 text-[14px] text-ink3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink/5 text-ink3">
                    <X className="h-3.5 w-3.5" />
                  </span>
                  {before}
                </span>
                <span className="flex items-center gap-2.5 text-[14px] font-medium text-ink">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue/10 text-blue">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                  {after}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <span className="mr-1 self-center text-[12px] text-ink3">Also inside</span>
          {ALSO.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-white/80 px-3 py-1 text-[12px] text-ink2 backdrop-blur-sm"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: item.accent }}
                aria-hidden
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
