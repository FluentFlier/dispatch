'use client';

import { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

function useFadeIn(delay = 0): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null!);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, delay);
        io.unobserve(el);
      }
    }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return ref;
}

function Fade({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useFadeIn(delay);
  return (
    <div ref={ref} className={className} style={{ opacity: 0, transform: 'translateY(20px)', transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms` }}>
      {children}
    </div>
  );
}

function useSpotlight() {
  const ref = useRef<HTMLDivElement>(null!);
  const move = useCallback((e: MouseEvent) => { if (ref.current) { ref.current.style.setProperty('--mx', `${e.clientX}px`); ref.current.style.setProperty('--my', `${e.clientY}px`); } }, []);
  useEffect(() => { window.addEventListener('mousemove', move); return () => window.removeEventListener('mousemove', move); }, [move]);
  return ref;
}

const features = [
  { tag: 'COMMENTS', title: 'Reply without the tab chaos', desc: 'Comments on your posts land in one inbox. AI drafts replies in your voice — you review and send.' },
  { tag: 'GENERATE', title: 'AI that writes like you', desc: 'Scripts, hooks, captions, and repurposing — with voice quality scores before you publish.' },
  { tag: 'ORGANIZE', title: 'Pipeline, not chaos', desc: 'Every post tracked from idea to posted. Pillar tags, status badges, bulk actions, and full-text search.' },
  { tag: 'SCHEDULE', title: 'Calendar with drag-and-drop', desc: 'Drag posts onto days. AI fills your week. Visual gaps show where momentum breaks.' },
  { tag: 'PUBLISH', title: 'Four platforms, one click', desc: 'X, LinkedIn, Instagram, Threads. OAuth connect, platform formatting, token refresh built in.' },
  { tag: 'ANALYZE', title: 'Know what ships', desc: 'Weekly AI reviews, pillar breakdowns, posting streaks, performance logs. Pattern detection across content.' },
  { tag: 'EDIT', title: 'Video studio built in', desc: 'Upload, template, preview. Auto-captions and smart cuts ready when you plug in a processing backend.' },
];

interface Props { loggedIn: boolean }

export default function LandingPageContent({ loggedIn }: Props) {
  const spotRef = useSpotlight();

  return (
    <div ref={spotRef} className="relative min-h-screen overflow-x-hidden bg-bg-primary font-body text-text-secondary">
      <style>{`
        @keyframes float1 { from { transform: translate(0,0) scale(1); } to { transform: translate(40px,30px) scale(1.1); } }
        @keyframes float2 { from { transform: translate(0,0) scale(1); } to { transform: translate(-30px,50px) scale(1.05); } }
        @keyframes shimmer { from { background-position: -200% center; } to { background-position: 200% center; } }
        @keyframes beam { from { transform: translateY(-100%) rotate(15deg); opacity: 0; } 50% { opacity: 1; } to { transform: translateY(200%) rotate(15deg); opacity: 0; } }
      `}</style>

      <div className="relative z-10">
        {/* Nav */}
        <nav className="flex items-center justify-between px-6 sm:px-10 py-5 max-w-6xl mx-auto">
          <span className="font-semibold text-[15px] tracking-[0.2em] text-text-primary">DISPATCH</span>
          <div className="flex items-center gap-4">
            {loggedIn ? (
              <Link href="/dashboard" className="px-5 py-2 text-[13px] font-semibold rounded-md bg-text-primary text-bg-primary hover:opacity-90 transition-all">Dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="text-[13px] text-text-tertiary hover:text-text-primary transition-colors">Sign in</Link>
                <Link href="/login" className="px-5 py-2 text-[13px] font-semibold rounded-md bg-text-primary text-bg-primary hover:opacity-90 transition-all">Get Started</Link>
              </>
            )}
          </div>
        </nav>

        {/* Hero */}
        <section className="pt-24 sm:pt-36 pb-28 px-6 sm:px-10 max-w-5xl mx-auto">
          <div className="w-24 h-1 mb-10 rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary" />

          <h1 className="font-semibold tracking-tight text-text-primary leading-[1.05]" style={{ fontSize: 'clamp(40px, 7vw, 72px)' }}>
            Your content,<br />
            <span className="text-accent-primary">in one place.</span>
          </h1>

          <p className="mt-6 max-w-lg text-[17px] text-text-secondary leading-relaxed">
            Write in your voice, schedule posts, and reply to comments — without jumping between apps. Built to be simple.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-9">
            <Link href="/login"
              className="group relative inline-flex items-center gap-2 px-7 py-3.5 min-h-[52px] text-[15px] font-semibold rounded-md bg-accent-primary text-text-inverse overflow-hidden transition-all hover:bg-accent-dark active:scale-[0.98] shadow-soft">
              <span className="relative">Get started free</span>
              <svg className="relative w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </Link>
            <Link href="#features" className="px-6 py-3.5 text-[14px] text-text-tertiary hover:text-text-primary transition-colors">See features &darr;</Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-8 mt-24 pt-8 border-t border-border">
            {[{ n: '8', l: 'AI writing tools' }, { n: '4', l: 'Platforms' }, { n: '5', l: 'Pipeline stages' }, { n: '<1m', l: 'Setup time' }].map((s, i) => (
              <div key={i}>
                <div className="font-semibold text-[36px] text-text-primary leading-none">{s.n}</div>
                <div className="text-[11px] text-text-secondary tracking-[0.1em] uppercase mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-6 sm:px-10 pb-28 max-w-5xl mx-auto">
          <Fade>
            <span className="text-[11px] font-semibold tracking-[0.14em] text-coral uppercase">Features</span>
            <h2 className="font-semibold mt-3 mb-14 text-text-primary tracking-[-0.03em] leading-[1.1]" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>
              Everything to go from<br /><em className="font-normal italic">idea to posted.</em>
            </h2>
          </Fade>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {features.map((f, i) => (
              <Fade key={i} delay={i * 60}>
                <div className="group rounded-lg p-6 bg-bg-secondary border border-border hover:border-accent-primary/40 shadow-card hover:shadow-soft transition-all duration-300 h-full">
                  <span className="inline-block px-2 py-0.5 rounded-badge text-[10px] font-medium tracking-wide text-accent-primary bg-coral-light mb-4">{f.tag}</span>
                  <h3 className="text-base font-semibold text-text-primary mb-1.5">{f.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{f.desc}</p>
                </div>
              </Fade>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="px-6 sm:px-10 py-24 max-w-5xl mx-auto border-t border-border">
          <Fade>
            <span className="text-[11px] font-semibold tracking-[0.14em] text-coral uppercase">Workflow</span>
            <h2 className="font-semibold mt-3 mb-16 text-text-primary tracking-[-0.03em] leading-[1.1]" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>
              Three steps. <em className="font-normal italic">That&apos;s it.</em>
            </h2>
          </Fade>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              { s: '01', t: 'Define your voice', d: 'Name, pillars, tone, background. The AI learns your style.' },
              { s: '02', t: 'Create and organize', d: 'Generate scripts, organize in library, drag posts onto calendar.' },
              { s: '03', t: 'Publish and reply', d: 'Post everywhere. Sync comments. Approve AI replies in one tap.' },
            ].map((s, i) => (
              <Fade key={i} delay={i * 120}>
                <div className="relative pl-5 border-l border-border">
                  <div className="absolute -left-[4px] top-0 w-[7px] h-[7px] rounded-full bg-accent-primary" />
                  <span className="text-[11px] text-text-secondary tracking-[0.08em]">{s.s}</span>
                  <h3 className="font-display text-[16px] font-semibold text-text-primary mt-2 mb-2">{s.t}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{s.d}</p>
                </div>
              </Fade>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="relative text-center py-28 px-6 overflow-hidden">
          <Fade className="relative">
            <h2 className="font-semibold text-text-primary tracking-[-0.03em] leading-tight" style={{ fontSize: 'clamp(34px, 6vw, 56px)' }}>
              Ready to ship<br />
              <span className="text-accent-primary">more content?</span>
            </h2>
            <p className="text-[16px] text-text-secondary mt-5 mb-9 max-w-md mx-auto">Free to use. Profile setup takes under a minute.</p>
            <Link href="/login"
              className="group relative inline-flex items-center gap-2 px-8 py-3.5 text-[15px] font-semibold rounded-lg bg-text-primary text-bg-primary overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98]">
              <span className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(110deg, transparent 30%, rgba(99,102,241,0.15) 50%, transparent 70%)', backgroundSize: '200% 100%', animation: 'shimmer 3s infinite' }} />
              <span className="relative">Get Started</span>
              <svg className="relative w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </Link>
          </Fade>
        </section>

        {/* Footer */}
        <footer className="px-6 sm:px-10 py-8 max-w-6xl mx-auto flex items-center justify-between border-t border-border">
          <span className="font-semibold text-[11px] tracking-[0.2em] text-text-tertiary">DISPATCH</span>
          <span className="text-[11px] text-text-tertiary">&copy; {new Date().getFullYear()}</span>
        </footer>
      </div>
    </div>
  );
}
