'use client';

import { useEffect, useRef } from 'react';
import type { ComponentType, ReactNode, RefObject } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  LayoutDashboard,
  MessageSquareText,
  Mic,
  PenLine,
  Sparkles,
  Video,
  SlidersHorizontal,
} from 'lucide-react';

function useFadeIn(delay = 0): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null!);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, delay);
        io.unobserve(el);
      }
    }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return ref;
}

function Fade({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useFadeIn(delay);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: 0,
        transform: 'translateY(18px)',
        transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

const surfaceCards = [
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    desc: 'Command center for your week, setup, and publishing pipeline.',
    href: '/dashboard',
  },
  {
    icon: PenLine,
    title: 'Generate',
    desc: 'Draft in your voice with hook intelligence and quality checks.',
    href: '/generate',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    desc: 'See performance, lead categories, and research signals in one place.',
    href: '/analytics',
  },
  {
    icon: Mic,
    title: 'Voice Lab',
    desc: 'Import public links, analyze tone, and train the writing model.',
    href: '/voice-lab',
  },
  {
    icon: BookOpen,
    title: 'Story Bank',
    desc: 'Save stories, angles, and proof so good ideas do not disappear.',
    href: '/story-bank',
  },
  {
    icon: SlidersHorizontal,
    title: 'Teleprompter',
    desc: 'Read scripts cleanly when a post becomes a video or live delivery.',
    href: '/teleprompter',
  },
  {
    icon: Video,
    title: 'Video Studio',
    desc: 'Turn clips into posts with captions, templates, and preview controls.',
    href: '/video-studio',
  },
  {
    icon: CalendarDays,
    title: 'Calendar',
    desc: 'Plan the week with a schedule that makes gaps and cadence obvious.',
    href: '/calendar',
  },
];

const previewNav = [
  { label: 'Dashboard', href: '/dashboard', active: true },
  { label: 'Generate', href: '/generate', active: false },
  { label: 'Voice Lab', href: '/voice-lab', active: false },
  { label: 'Analytics', href: '/analytics', active: false },
  { label: 'Story Bank', href: '/story-bank', active: false },
  { label: 'Teleprompter', href: '/teleprompter', active: false },
] as const;

interface Props {
  loggedIn: boolean;
}

function PreviewMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-primary px-4 py-3">
      <div className="text-[22px] font-semibold leading-none text-text-primary">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">{label}</div>
    </div>
  );
}

function SurfaceCard({
  icon: Icon,
  title,
  desc,
  href,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-bg-secondary p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-accent-primary/40 hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-bg-primary text-accent-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
            <p className="mt-1 text-[13px] leading-6 text-text-secondary">{desc}</p>
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export default function LandingPageContent({ loggedIn }: Props) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg-primary font-body text-text-secondary">
      <div className="relative z-10">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-10">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold tracking-[0.22em] text-text-primary">DISPATCH</span>
            <span className="hidden rounded-badge border border-border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-text-tertiary sm:inline-flex">
              Content OS
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/pricing" className="hidden text-[13px] text-text-tertiary transition-colors hover:text-text-primary sm:inline-flex">
              Pricing
            </Link>
            {loggedIn ? (
              <Link href="/dashboard" className="btn-primary">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-secondary">
                  Sign in
                </Link>
                <Link href="/login" className="btn-primary">
                  Start free
                </Link>
              </>
            )}
          </div>
        </nav>

        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 pb-18 pt-10 sm:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-18">
          <Fade className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">Product suite</p>
            <h1 className="mt-4 text-[clamp(42px,7vw,78px)] font-semibold leading-[0.96] tracking-[-0.05em] text-text-primary">
              One workspace for content that actually ships.
            </h1>
            <p className="mt-6 max-w-2xl text-[17px] leading-8 text-text-secondary">
              Dispatch keeps the whole loop in one place, research, writing, voice training, scheduling, publishing, replies, and the intelligence that tells you what to do next.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={loggedIn ? '/dashboard' : '/login'} className="btn-primary">
                {loggedIn ? 'Open dashboard' : 'Get started free'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="btn-secondary">
                View pricing
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {['Dashboard', 'Generate', 'Voice Lab', 'Analytics', 'Story Bank', 'Teleprompter', 'Video Studio'].map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-badge border border-border bg-bg-secondary px-3 py-1.5 text-[12px] font-medium text-text-secondary"
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { value: '8', label: 'surfaces shipped' },
                { value: '4', label: 'publish targets' },
                { value: '<1m', label: 'setup to first draft' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-border bg-bg-secondary px-4 py-4 shadow-card">
                  <div className="text-[28px] font-semibold leading-none text-text-primary">{stat.value}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">{stat.label}</div>
                </div>
              ))}
            </div>
          </Fade>

          <Fade delay={80}>
            <div className="rounded-2xl border border-border bg-bg-secondary shadow-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-2 text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Live workspace preview</span>
              </div>

              <div className="grid gap-0 lg:grid-cols-[190px_minmax(0,1fr)]">
                <aside className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Workspace</div>
                  <div className="mt-3 space-y-1">
                    {previewNav.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors ${
                          item.active
                            ? 'bg-bg-primary text-text-primary'
                            : 'text-text-secondary hover:bg-bg-primary hover:text-text-primary'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="text-text-tertiary">/</span>
                      </Link>
                    ))}
                  </div>
                </aside>

                <div className="p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <PreviewMetric value="12" label="published this week" />
                    <PreviewMetric value="4" label="posts in pipeline" />
                    <PreviewMetric value="27" label="lead signals" />
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-xl border border-border bg-bg-primary p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Generate</div>
                          <h3 className="mt-1 text-[15px] font-semibold text-text-primary">Drafts that read like the same person wrote them</h3>
                        </div>
                        <Sparkles className="h-5 w-5 text-accent-primary" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {[
                          'Hook intelligence pulled from live patterns',
                          'Voice score before you publish',
                          'One click to save, schedule, or send to teleprompter',
                        ].map((line) => (
                          <div key={line} className="flex items-start gap-2 text-[13px] text-text-secondary">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-secondary" />
                            <span>{line}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-xl border border-border bg-bg-primary p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Voice Lab</div>
                            <p className="mt-1 text-[13px] text-text-secondary">Import public links and train tone from real writing.</p>
                          </div>
                          <Mic className="h-5 w-5 text-accent-primary" />
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-bg-primary p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Analytics</div>
                            <p className="mt-1 text-[13px] text-text-secondary">Lead buckets, research runs, and post performance in one view.</p>
                          </div>
                          <BarChart3 className="h-5 w-5 text-accent-primary" />
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-bg-primary p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Video Studio</div>
                            <p className="mt-1 text-[13px] text-text-secondary">Captions, template previews, and delivery-ready clips.</p>
                          </div>
                          <Video className="h-5 w-5 text-accent-primary" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_0.9fr]">
                    <div className="rounded-xl border border-border bg-bg-primary p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Pipeline</div>
                          <p className="mt-1 text-[13px] text-text-secondary">Schedule, publish, and keep the week visible.</p>
                        </div>
                        <CalendarDays className="h-5 w-5 text-accent-primary" />
                      </div>
                      <div className="mt-4 space-y-2">
                        {[
                          ['Mon', 'LinkedIn carousel', 'Queued'],
                          ['Wed', 'X thread', 'Ready'],
                          ['Fri', 'Video script', 'In review'],
                        ].map(([day, title, status]) => (
                          <div key={title} className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[13px]">
                            <span className="text-text-secondary">{day}</span>
                            <span className="truncate px-2 text-text-primary">{title}</span>
                            <span className="text-text-tertiary">{status}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-bg-primary p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Reply engine</div>
                          <p className="mt-1 text-[13px] text-text-secondary">Turn comments into leads, not noise.</p>
                        </div>
                        <MessageSquareText className="h-5 w-5 text-accent-primary" />
                      </div>
                      <div className="mt-4 rounded-lg border border-border bg-bg-secondary p-3">
                        <p className="text-[12px] text-text-secondary">New signal detected</p>
                        <p className="mt-1 text-[14px] font-medium text-text-primary">Reply with a short answer and save the conversation to the brain.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Fade>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-18 sm:px-10">
          <Fade>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">Inside the suite</p>
            <h2 className="mt-3 text-[clamp(30px,4vw,44px)] font-semibold leading-[1.06] tracking-[-0.04em] text-text-primary">
              One product, eight useful surfaces.
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-text-secondary">
              The point is not to bury the good parts. It is to let a buyer see the loop in seconds and understand why the system is worth paying for.
            </p>
          </Fade>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {surfaceCards.map((surface, index) => (
              <Fade key={surface.title} delay={index * 50}>
                <SurfaceCard {...surface} />
              </Fade>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-18 pt-2 sm:px-10">
          <Fade className="text-center">
            <h2 className="text-[clamp(34px,6vw,58px)] font-semibold leading-[1] tracking-[-0.05em] text-text-primary">
              Ready to ship more content?
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-7 text-text-secondary">
              Free to use. Profile setup takes under a minute, and the rest of the workspace is already waiting.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href={loggedIn ? '/dashboard' : '/login'} className="btn-primary">
                {loggedIn ? 'Open dashboard' : 'Get started free'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="btn-secondary">
                View pricing
              </Link>
            </div>
          </Fade>
        </section>

        <footer className="mx-auto flex max-w-7xl items-center justify-between border-t border-border px-6 py-8 sm:px-10">
          <span className="text-[11px] font-semibold tracking-[0.2em] text-text-tertiary">DISPATCH</span>
          <span className="text-[11px] text-text-tertiary">&copy; {new Date().getFullYear()}</span>
        </footer>
      </div>
    </div>
  );
}
