/**
 * "Why it's different" — a two-column comparison ledger (generic AI scheduler vs
 * Content OS). Mirrors the Problem ledger styling but with a 1fr/1fr grid and no
 * arrow column, contrasting passive tooling against the compounding loop.
 */
const ROWS: [string, string][] = [
  ['Writes from cold prompts', 'Learns from your actual content'],
  ['Helps you post once', 'Builds a repeatable publishing loop'],
  ['Treats analytics as reports', 'Uses analytics as training signal'],
  ['Comments are an inbox', 'Comments become new ideas'],
  ['Generic tone controls', 'A persistent voice fingerprint'],
];

export default function Different() {
  return (
    <section id="different" className="mx-auto max-w-[1180px] px-10 pb-10 pt-24">
      <div className="mb-11 max-w-[640px]">
        <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
          07 / WHY IT&apos;S DIFFERENT
        </span>
        <h2 className="ed-serif mb-[14px] mt-[18px] text-[clamp(30px,3.8vw,50px)] font-normal leading-[1.0] tracking-[-0.025em] text-ink">
          Not another AI caption generator.
        </h2>
        <p className="m-0 text-[16.5px] leading-[1.6] text-ink2">
          Built around your voice, your stories, your audience, and your publishing loop —
          so it gets sharper the more you use it.
        </p>
      </div>

      <div className="border-t border-ink">
        <div className="grid grid-cols-2 gap-x-10 border-b border-hair py-[14px]">
          <span className="font-mono text-[11px] tracking-[0.06em] text-ink3">
            GENERIC AI SCHEDULER
          </span>
          <span className="font-mono text-[11px] tracking-[0.06em] text-blue">
            CONTENT OS
          </span>
        </div>
        {ROWS.map(([before, after], i) => (
          <div
            key={before}
            className={`grid grid-cols-2 gap-x-10 py-[18px] ${
              i < ROWS.length - 1 ? 'border-b border-hair' : ''
            }`}
          >
            <span className="text-[16px] text-ink3">{before}</span>
            <span className="text-[16px] font-medium text-ink">{after}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
