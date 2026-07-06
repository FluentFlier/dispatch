import {
  BarChart3,
  Brain,
  CalendarDays,
  MessageSquare,
  PenLine,
  Sparkles,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

const CAPABILITIES = [
  {
    icon: PenLine,
    title: 'Generate',
    copy: 'Scripts, hooks, captions. Voice QA on every draft.',
  },
  {
    icon: CalendarDays,
    title: 'Calendar',
    copy: 'Drag, schedule, fill the week. LinkedIn and X.',
  },
  {
    icon: MessageSquare,
    title: 'Comments',
    copy: 'Sync replies. Draft in your voice. Send approved.',
  },
  {
    icon: Sparkles,
    title: 'Hook intelligence',
    copy: 'Viral patterns mined into your Generate flow.',
  },
  {
    icon: Brain,
    title: 'Creator Brain',
    copy: 'Every publish trains the next draft.',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    copy: 'Pillar breakdowns and what actually worked.',
  },
] as const;

export default function LandingCapabilities() {
  return (
    <section id="features" className="scroll-mt-24 border-t border-hair/60">
      <div className="mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <h2 className="m-0 text-[clamp(26px,3.5vw,40px)] font-semibold tracking-[-0.03em] text-ink">
          Everything creators actually use.
        </h2>
        <p className="m-0 mt-3 text-[15px] text-ink2">Not a caption toy. A full command center.</p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <Card key={item.title} className="flex gap-3 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-light text-accent-primary">
                <item.icon className="h-4 w-4" />
              </span>
              <div>
                <h3 className="m-0 text-[15px] font-semibold text-text-primary">{item.title}</h3>
                <p className="m-0 mt-1 text-[13px] leading-relaxed text-text-secondary">
                  {item.copy}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
