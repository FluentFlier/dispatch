import { PRODUCT_NAME } from './brand';

/**
 * "Why it's different" — two-column comparison ledger (generic AI scheduler vs Content OS).
 */
const ROWS: [string, string][] = [
  ['Writes from cold prompts', 'Learns from your actual content'],
  ['No memory between posts', 'Creator Brain learns from every publish'],
  ['Treats analytics as reports', 'Uses analytics as training signal'],
  ['Voice drifts post to post', 'A persistent voice fingerprint'],
  ['One platform at a time', 'Native formats for X, LinkedIn, IG & Threads'],
];

export default function Different() {
  return (
    <section id="different" className="scroll-mt-24 mx-auto max-w-[1180px] px-5 pb-10 pt-16 sm:px-10 sm:pt-24">
      <div className="mb-11 max-w-[640px]">
        <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
          07 / WHY IT&apos;S DIFFERENT
        </span>
        <h2 className="ed-serif mb-[14px] mt-[18px] text-[clamp(28px,3.8vw,50px)] font-normal leading-[1.0] tracking-[-0.025em] text-ink">
          Not another AI caption generator.
        </h2>
        <p className="m-0 text-[16px] leading-[1.6] text-ink2 sm:text-[16.5px]">
          Built around your voice, your stories, your audience, and your publishing loop —
          so it gets sharper the more you use it.
        </p>
      </div>

      <div className="border-t border-ink">
        <div className="grid grid-cols-1 gap-y-2 border-b border-hair py-[14px] sm:grid-cols-2 sm:gap-x-10">
          <span className="font-mono text-[11px] tracking-[0.06em] text-ink3">
            GENERIC AI SCHEDULER
          </span>
          <span className="font-mono text-[11px] tracking-[0.06em] text-blue">
            {PRODUCT_NAME.toUpperCase()}
          </span>
        </div>
        {ROWS.map(([before, after], i) => (
          <div
            key={before}
            className={`grid grid-cols-1 gap-y-1 py-[18px] sm:grid-cols-2 sm:gap-x-10 ${
              i < ROWS.length - 1 ? 'border-b border-hair' : ''
            }`}
          >
            <span className="text-[15px] text-ink3 sm:text-[16px]">{before}</span>
            <span className="text-[15px] font-medium text-ink sm:text-[16px]">{after}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
