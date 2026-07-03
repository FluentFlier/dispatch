import { PRODUCT_NAME } from './brand';

const ROWS: [string, string][] = [
  ['Ideas everywhere', 'One Story Bank'],
  ['Generic AI drafts', 'Your voice, scored'],
  ['Scheduling elsewhere', 'Publish in-app'],
  ['Comments die', 'Replies → next posts'],
];

export default function Problem() {
  return (
    <section
      id="problem"
      className="scroll-mt-24 mx-auto max-w-[1180px] border-t border-hair px-5 pb-10 pt-14 sm:px-10 sm:pt-20"
    >
      <div className="grid grid-cols-1 items-start gap-8 sm:gap-10 lg:grid-cols-[0.38fr_1fr]">
        <div className="lg:sticky lg:top-[100px]">
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">02 / PROBLEM</span>
          <h2 className="ed-serif mb-3 mt-4 text-[clamp(28px,3.6vw,42px)] font-normal leading-[1.02] tracking-[-0.025em] text-ink">
            Scattered tools leak signal.
          </h2>
        </div>

        <div>
          <div className="hidden grid-cols-[1fr_28px_1fr] items-center gap-x-4 border-b border-ink pb-3 sm:grid">
            <span className="font-mono text-[11px] tracking-[0.08em] text-ink3">TODAY</span>
            <span />
            <span className="font-mono text-[11px] tracking-[0.08em] text-blue">
              {PRODUCT_NAME.toUpperCase()}
            </span>
          </div>
          {ROWS.map(([before, after], i) => (
            <div
              key={before}
              className={`py-4 ${i < ROWS.length - 1 ? 'border-b border-hair' : ''}`}
            >
              <div className="flex flex-col gap-2 sm:hidden">
                <span className="text-[15px] text-ink3">{before}</span>
                <span className="text-[15px] font-medium text-ink">{after}</span>
              </div>
              <div className="hidden grid-cols-[1fr_28px_1fr] items-baseline gap-x-4 sm:grid">
                <span className="text-[15px] text-ink3">{before}</span>
                <span className="font-mono text-ink3">→</span>
                <span className="text-[15px] font-medium text-ink">{after}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
