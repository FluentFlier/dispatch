/**
 * "The Problem" — a typographic ledger contrasting today's scattered workflow with
 * the Content OS replacement. Left column is sticky so the framing holds while the
 * ledger scrolls. Each row is scattered-item · mono arrow · Content OS replacement.
 */
const ROWS: [string, string][] = [
  ['Ideas scattered across Notes, Notion & DMs', 'One searchable Story Bank'],
  ['AI writes generic, off-voice posts', 'Voice-scored drafts that sound like you'],
  ['Scheduling lives in a separate app', 'Native calendar & publishing pipeline'],
  ['Comments disappear after you publish', 'Replies become your next ideas'],
  ['Analytics are passive reports you ignore', 'A weekly learning loop that compounds'],
];

export default function Problem() {
  return (
    <section
      id="problem"
      className="mx-auto max-w-[1180px] border-t border-hair px-10 pb-10 pt-24"
    >
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.42fr_1fr]">
        <div className="lg:sticky lg:top-[100px]">
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
            02 / THE PROBLEM
          </span>
          <h2 className="ed-serif mb-4 mt-[18px] text-[clamp(30px,3.6vw,46px)] font-normal leading-[1.0] tracking-[-0.025em] text-ink">
            Your workflow is leaking signal.
          </h2>
          <p className="m-0 max-w-[34ch] text-[16px] leading-[1.55] text-ink2">
            Your best ideas are buried in calendar events, notes, DMs, comments, and
            half-written drafts. Most tools help you post once — then forget.
          </p>
        </div>

        <div>
          <div className="grid grid-cols-[1fr_28px_1fr] items-center gap-x-[18px] border-b border-ink pb-[14px]">
            <span className="font-mono text-[11px] tracking-[0.08em] text-ink3">
              TODAY — SCATTERED
            </span>
            <span />
            <span className="font-mono text-[11px] tracking-[0.08em] text-blue">
              WITH CONTENT OS
            </span>
          </div>
          {ROWS.map(([before, after], i) => (
            <div
              key={before}
              className={`grid grid-cols-[1fr_28px_1fr] items-baseline gap-x-[18px] py-5 ${
                i < ROWS.length - 1 ? 'border-b border-hair' : ''
              }`}
            >
              <span className="text-[16px] text-ink3">{before}</span>
              <span className="font-mono text-ink3">→</span>
              <span className="text-[16px] font-medium text-ink">{after}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
