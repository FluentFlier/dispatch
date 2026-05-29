'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Hash,
  MessageSquareText,
  Mic,
  Sparkles,
  Video,
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

const previewNav = [
  { label: 'Dashboard', href: '/dashboard', active: true },
  { label: 'Generate', href: '/generate', active: false },
  { label: 'Voice Lab', href: '/voice-lab', active: false },
  { label: 'Analytics', href: '/analytics', active: false },
  { label: 'Story Bank', href: '/story-bank', active: false },
  { label: 'Teleprompter', href: '/teleprompter', active: false },
] as const;

const surfaceGroups = [
  {
    title: 'Create',
    summary: 'Drafts, voice, and source material.',
    items: [
      { label: 'Generate', href: '/generate', detail: 'Write in your voice.' },
      { label: 'Voice Lab', href: '/voice-lab', detail: 'Import public links and train tone.' },
      { label: 'Story Bank', href: '/story-bank', detail: 'Save proof, angles, and notes.' },
    ],
  },
  {
    title: 'Ship',
    summary: 'Planning and publishing surfaces.',
    items: [
      { label: 'Dashboard', href: '/dashboard', detail: 'Command center for the week.' },
      { label: 'Calendar', href: '/calendar', detail: 'Slot posts into days.' },
      { label: 'Teleprompter', href: '/teleprompter', detail: 'Read scripts cleanly on camera.' },
      { label: 'Video Studio', href: '/video-studio', detail: 'Turn clips into posts.' },
    ],
  },
  {
    title: 'Learn',
    summary: 'Signal, replies, and performance.',
    items: [
      { label: 'Analytics', href: '/analytics', detail: 'Lead buckets and post performance.' },
      { label: 'Inbox', href: '/inbox', detail: 'Reply workflow in one place.' },
      { label: 'Ideas', href: '/ideas', detail: 'Keep the backlog moving.' },
      { label: 'Series', href: '/series', detail: 'Package recurring content.' },
    ],
  },
] as const;

const socialReel = [
  {
    platform: 'X',
    handle: '@levelsio',
    tone: 'Post',
    text: 'Most content tools help you publish. Dispatch helps you keep the whole week moving.',
  },
  {
    platform: 'LinkedIn',
    handle: 'Maya Chen',
    tone: 'Carousel',
    text: 'One draft becomes a post, a reply, a clip, and a signal trail. That is the product.',
  },
  {
    platform: 'Threads',
    handle: '@creatorstudio',
    tone: 'Reply',
    text: 'Clean reply loops beat chaotic inboxes. The follow-through is where the value shows up.',
  },
  {
    platform: 'Instagram',
    handle: '@studioflow',
    tone: 'Video',
    text: 'Voice training, captions, and scheduling in one flow is what makes the stack feel real.',
  },
  {
    platform: 'X',
    handle: '@foundermode',
    tone: 'Thread',
    text: 'The best landing pages do not explain the product. They let you see the product working.',
  },
  {
    platform: 'LinkedIn',
    handle: 'Nina Patel',
    tone: 'Post',
    text: 'When analytics and writing share the same memory, the whole loop gets sharper.',
  },
] as const;

interface Props {
  loggedIn: boolean;
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-badge border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/70">
      <Hash className="h-3 w-3" />
      {platform}
    </span>
  );
}

function PreviewMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <div className="text-[22px] font-semibold leading-none text-white">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/45">{label}</div>
    </div>
  );
}

function SocialCard({
  platform,
  handle,
  tone,
  text,
}: {
  platform: string;
  handle: string;
  tone: string;
  text: string;
}) {
  return (
    <article className="w-[280px] shrink-0 rounded-[22px] border border-border bg-bg-secondary p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-primary text-[12px] font-semibold text-text-primary">
            {platform.slice(0, 1)}
          </div>
          <div>
            <p className="text-[13px] font-medium text-text-primary">{handle}</p>
            <p className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">{tone}</p>
          </div>
        </div>
        <PlatformBadge platform={platform} />
      </div>
      <p className="mt-4 text-[14px] leading-6 text-text-secondary">{text}</p>
      <div className="mt-4 flex items-center gap-3 border-t border-border pt-3 text-[11px] text-text-tertiary">
        <span>Drafted in Dispatch</span>
        <span>•</span>
        <span>Ready to schedule</span>
      </div>
    </article>
  );
}

export default function LandingPageContent({ loggedIn }: Props) {
  const reel = [...socialReel, ...socialReel];

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg-primary font-body text-text-secondary">
      <style>{`
        @keyframes reel-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

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

        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 pb-14 pt-10 sm:px-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pt-16">
          <Fade className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">Product suite</p>
            <h1 className="mt-4 text-[clamp(44px,8vw,92px)] font-semibold leading-[0.92] tracking-[-0.06em] text-text-primary">
              Dispatch.
            </h1>
            <p className="mt-4 max-w-2xl text-[18px] leading-8 text-text-secondary">
              One workspace for content that actually ships.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-text-secondary">
              Research, writing, voice training, scheduling, publishing, replies, and analytics all live in one loop. The page should make that obvious in seconds.
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
              {['Dashboard', 'Generate', 'Voice Lab', 'Analytics', 'Story Bank', 'Teleprompter', 'Video Studio', 'Calendar'].map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-badge border border-border bg-bg-secondary px-3 py-1.5 text-[12px] font-medium text-text-secondary"
                >
                  {item}
                </span>
              ))}
            </div>
          </Fade>

          <Fade delay={90}>
            <div className="rounded-[28px] border border-border bg-[#111827] p-4 shadow-card">
              <div className="flex items-center gap-2 border-b border-white/10 px-1 pb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-2 text-[11px] uppercase tracking-[0.14em] text-white/45">Live workspace preview</span>
              </div>

              <div className="grid gap-0 lg:grid-cols-[170px_minmax(0,1fr)]">
                <aside className="border-b border-white/10 py-4 pr-4 lg:border-b-0 lg:border-r lg:pr-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Workspace</div>
                  <div className="mt-3 space-y-1">
                    {previewNav.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors ${
                          item.active
                            ? 'bg-white text-[#111827]'
                            : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="text-white/40">/</span>
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
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Generate</div>
                          <h2 className="mt-1 text-[15px] font-semibold text-white">Drafts that read like the same person wrote them</h2>
                        </div>
                        <Sparkles className="h-5 w-5 text-cyan-300" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {[
                          'Hook intelligence pulled from live patterns',
                          'Voice score before you publish',
                          'One click to save, schedule, or send to teleprompter',
                        ].map((line) => (
                          <div key={line} className="flex items-start gap-2 text-[13px] text-white/72">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                            <span>{line}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Voice Lab</div>
                            <p className="mt-1 text-[13px] text-white/72">Import public links and train tone from real writing.</p>
                          </div>
                          <Mic className="h-5 w-5 text-cyan-300" />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Analytics</div>
                            <p className="mt-1 text-[13px] text-white/72">Lead buckets, research runs, and post performance.</p>
                          </div>
                          <BarChart3 className="h-5 w-5 text-cyan-300" />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Video Studio</div>
                            <p className="mt-1 text-[13px] text-white/72">Captions, template previews, and delivery-ready clips.</p>
                          </div>
                          <Video className="h-5 w-5 text-cyan-300" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_0.9fr]">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Pipeline</div>
                          <p className="mt-1 text-[13px] text-white/72">Schedule, publish, and keep the week visible.</p>
                        </div>
                        <CalendarDays className="h-5 w-5 text-cyan-300" />
                      </div>
                      <div className="mt-4 space-y-2">
                        {[
                          ['Mon', 'LinkedIn carousel', 'Queued'],
                          ['Wed', 'X thread', 'Ready'],
                          ['Fri', 'Video script', 'In review'],
                        ].map(([day, title, status]) => (
                          <div key={title} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px]">
                            <span className="text-white/65">{day}</span>
                            <span className="truncate px-2 text-white">{title}</span>
                            <span className="text-white/45">{status}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Reply engine</div>
                          <p className="mt-1 text-[13px] text-white/72">Turn comments into leads, not noise.</p>
                        </div>
                        <MessageSquareText className="h-5 w-5 text-cyan-300" />
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b1220] p-3">
                        <p className="text-[12px] text-white/45">New signal detected</p>
                        <p className="mt-1 text-[14px] font-medium text-white">Reply with a short answer and save the conversation to the brain.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Fade>
        </section>

        <section className="border-y border-border bg-bg-secondary/40">
          <div className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">Visual demo</p>
                <h2 className="mt-2 text-[clamp(26px,3.5vw,38px)] font-semibold leading-[1.05] tracking-[-0.04em] text-text-primary">
                  Social content moving through the system.
                </h2>
              </div>
              <div className="hidden items-center gap-2 rounded-badge border border-border bg-bg-primary px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-text-tertiary md:inline-flex">
                Motion reel
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>

            <div className="mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
              <div
                className="flex w-max gap-4"
                style={{ animation: 'reel-scroll 34s linear infinite' }}
              >
                {reel.map((item, index) => (
                  <SocialCard key={`${item.handle}-${index}`} {...item} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-18 sm:px-10">
          <Fade>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">Inside the suite</p>
            <h2 className="mt-3 text-[clamp(30px,4vw,44px)] font-semibold leading-[1.06] tracking-[-0.04em] text-text-primary">
              Everything is already here.
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-text-secondary">
              The page should show the full loop fast, so a buyer understands where the value lives and where the next click goes.
            </p>
          </Fade>

          <div className="mt-10 grid gap-0 rounded-[28px] border border-border bg-bg-secondary/70 shadow-card lg:grid-cols-3">
            {surfaceGroups.map((group, index) => (
              <Fade key={group.title} delay={index * 50}>
                <div className={`h-full p-6 ${index !== surfaceGroups.length - 1 ? 'border-b border-border lg:border-b-0 lg:border-r' : ''}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-primary">{group.title}</p>
                  <p className="mt-3 text-[15px] font-medium text-text-primary">{group.summary}</p>
                  <div className="mt-5 space-y-2">
                    {group.items.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="group flex items-start justify-between gap-4 rounded-2xl border border-border bg-bg-primary px-4 py-3 transition-colors hover:border-accent-primary/40"
                      >
                        <div>
                          <p className="text-[14px] font-medium text-text-primary">{item.label}</p>
                          <p className="mt-1 text-[12px] leading-5 text-text-secondary">{item.detail}</p>
                        </div>
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    ))}
                  </div>
                </div>
              </Fade>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-18 pt-2 sm:px-10">
          <Fade className="rounded-[28px] border border-border bg-bg-secondary px-6 py-10 text-center shadow-card sm:px-8">
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
