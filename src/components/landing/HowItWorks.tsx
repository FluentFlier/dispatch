import { CalendarDays, MessageSquare, PenLine } from 'lucide-react';
import { PRODUCT_NAME } from './editorial/brand';

const STEPS = [
  {
    icon: PenLine,
    title: 'Capture and draft',
    copy: 'Turn calendar events, notes, and comments into native posts scored in your voice.',
  },
  {
    icon: CalendarDays,
    title: 'Publish everywhere',
    copy: 'Queue LinkedIn and X from one calendar without reformatting.',
  },
  {
    icon: MessageSquare,
    title: 'Reply and learn',
    copy: 'High-signal replies become next week\'s ideas. Creator Brain compounds every publish.',
  },
] as const;

export default function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 border-t border-hair/80 bg-white/50">
      <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-10 sm:py-24">
        <div className="max-w-2xl">
          <h2 className="m-0 text-[clamp(28px,4vw,44px)] font-semibold tracking-[-0.03em] text-ink">
            The quiet layer between your ideas and your audience.
          </h2>
          <p className="m-0 mt-4 text-[16px] leading-relaxed text-ink2">
            Most creators lose signal across tools. {PRODUCT_NAME} keeps capture, drafting,
            publishing, and replies in one loop that gets sharper every week.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <article
              key={step.title}
              className="rounded-2xl border border-hair bg-white/80 p-6 shadow-[0_12px_40px_-24px_rgba(23,23,23,0.18)] backdrop-blur-sm"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue/10 text-blue">
                  <step.icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-[11px] text-ink3">0{i + 1}</span>
              </div>
              <h3 className="m-0 text-[18px] font-semibold text-ink">{step.title}</h3>
              <p className="m-0 mt-2 text-[14px] leading-relaxed text-ink2">{step.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
