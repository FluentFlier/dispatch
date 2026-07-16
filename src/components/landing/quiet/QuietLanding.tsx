'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check, ChevronRight, Menu, X } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { LinkPreview } from '@/components/ui/link-preview';
import { SmoothCursor } from '@/components/ui/smooth-cursor';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import LandingSmoothScroll from '../LandingSmoothScroll';
import KineticPosterSections from './KineticPosterSections';

const EASE = [0.16, 1, 0.3, 1] as const;
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue focus-visible:ring-offset-[3px] focus-visible:ring-offset-paper';

function QuietNav({ funnel }: { funnel: FunnelState }) {
  const [open, setOpen] = useState(false);
  const cta = getFunnelCta(funnel);

  return (
    <nav className="relative z-50 border-b border-transparent" aria-label="Main navigation">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className={`flex min-h-11 items-center gap-2 text-ink ${FOCUS}`}>
          <span className="text-[20px] font-bold leading-none tracking-[-0.045em]">
            content os<span className="text-blue">.</span>
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          <a href="#product" className={`text-sm text-ink2 transition-colors hover:text-ink ${FOCUS}`}>
            Product
          </a>
          <a href="#loop" className={`text-sm text-ink2 transition-colors hover:text-ink ${FOCUS}`}>
            The loop
          </a>
          <Link href="/pricing" className={`text-sm text-ink2 transition-colors hover:text-ink ${FOCUS}`}>
            Pricing
          </Link>
          {!funnel.loggedIn && (
            <Link href="/login" className={`text-sm text-ink2 transition-colors hover:text-ink ${FOCUS}`}>
              Sign in
            </Link>
          )}
          <Link href={cta.href} className={`quiet-button-primary min-h-11 px-4 text-sm ${FOCUS}`}>
            {cta.label}
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="quiet-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
          className={`grid h-11 w-11 place-items-center rounded-[10px] border border-hair bg-surface text-ink md:hidden ${FOCUS}`}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div id="quiet-mobile-nav" className="mx-5 border-y border-hair bg-paper py-3 md:hidden">
          <div className="flex flex-col">
            {[
              ['#loop', 'The loop'],
              ['/pricing', 'Pricing'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center justify-between py-2 text-sm font-medium text-ink ${FOCUS}`}
              >
                {label}
                <ChevronRight className="h-4 w-4 text-ink3" />
              </Link>
            ))}
            <Link
              href={cta.href}
              onClick={() => setOpen(false)}
              className={`quiet-button-primary mt-2 min-h-12 justify-center ${FOCUS}`}
            >
              {cta.label}
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function Hero({ funnel }: { funnel: FunnelState }) {
  const reduceMotion = useReducedMotion();
  const cta = getFunnelCta(funnel);
  const productRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: productScroll } = useScroll({
    target: productRef,
    offset: ['start end', 'end start'],
  });
  const productLiftY = useSpring(useTransform(productScroll, [0, 0.35, 0.65, 1], [72, 0, 0, -72]), {
    stiffness: 82,
    damping: 24,
    mass: 0.42,
  });
  const productScale = useSpring(useTransform(productScroll, [0, 0.35, 0.65, 1], [0.91, 1, 1, 0.91]), {
    stiffness: 82,
    damping: 24,
    mass: 0.42,
  });
  const productOpacity = useSpring(useTransform(productScroll, [0, 0.2, 0.72, 1], [0.35, 1, 1, 0]), {
    stiffness: 100,
    damping: 26,
    mass: 0.3,
  });

  return (
    <header className="relative overflow-x-clip overflow-y-visible bg-surface">
      <div className="pointer-events-none absolute left-[8%] top-[34%] h-24 w-24 rounded-full bg-lime/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute right-[10%] top-[20%] h-32 w-32 rounded-full bg-lilac/20 blur-3xl" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1240px] px-5 pb-8 pt-8 sm:px-8 sm:pb-10 sm:pt-10 lg:pt-12">
        <div className="mx-auto w-full max-w-[900px]">
          <Image
            src="/images/content-relay-characters.png"
            alt="A colorful illustrated relay carries an idea through creation and toward a warm lead."
            width={1320}
            height={255}
            priority
            className="h-auto w-full"
          />
        </div>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: reduceMotion ? 0 : 0.45, ease: EASE }}
          className="relative z-10 mx-auto mt-0 max-w-[980px] text-center sm:-mt-3"
        >
          <h1 className="m-0 text-[clamp(3.25rem,7.8vw,7rem)] font-bold leading-[0.88] tracking-[-0.065em] text-ink">
            Content and leads.
            <span className="mt-2 block">
              <span className="relative inline-block whitespace-nowrap rounded-[0.24em] bg-blue px-[0.12em] pb-[0.09em] pr-[0.18em] text-paper">
                One loop.
              </span>
            </span>
          </h1>
          <div className="mx-auto mb-0 mt-6 max-w-[36rem] text-base leading-7 text-ink2 sm:text-lg">
            Write in your voice, publish to{' '}
            <LinkPreview
              url="https://www.linkedin.com/"
              width={280}
              height={176}
              className={`relative inline-flex h-6 w-6 align-[-0.26em] overflow-hidden rounded-[5px] transition-transform hover:-translate-y-0.5 hover:scale-105 ${FOCUS}`}
            >
              <Image
                src="/images/brands/linkedin.png"
                alt="LinkedIn"
                width={24}
                height={24}
                className="h-6 w-6"
              />
            </LinkPreview>
            {' '}and{' '}
            <LinkPreview
              url="https://x.com/"
              width={280}
              height={176}
              className={`relative inline-flex h-6 w-6 items-center justify-center align-[-0.2em] overflow-hidden rounded-[5px] transition-transform hover:-translate-y-0.5 hover:scale-105 ${FOCUS}`}
            >
              <Image
                src="/images/brands/x.png"
                alt="X"
                width={20}
                height={20}
                className="h-5 w-5 rounded-[3px]"
              />
            </LinkPreview>
            {', reply faster, and reach warm contacts without losing the context between each step.'}
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <Link href={cta.href} className={`quiet-button-primary ${FOCUS}`}>
              {cta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>

        <div
          ref={productRef}
          id="product"
          className="relative z-20 mx-auto -mb-24 mt-16 hidden max-w-[1120px] md:block"
        >
          <div className="relative z-10">
            <motion.div
              style={{
                boxShadow:
                  '0 48px 96px -34px rgb(24 22 20 / 0.42), 0 18px 38px -24px rgb(24 22 20 / 0.26)',
                ...(reduceMotion
                  ? {}
                  : { y: productLiftY, scale: productScale, opacity: productOpacity }),
              }}
              className="origin-bottom transform-gpu overflow-hidden rounded-[22px] border border-ink/15 bg-surface"
            >
              <Image
                src="/images/content-os-writing-page.jpg"
                alt="Content OS Write screen with the prompt What are we creating today and a draft composer for LinkedIn posts in your voice."
                width={1024}
                height={642}
                priority
                className="h-auto w-full"
              />
            </motion.div>
          </div>
        </div>
      </div>
    </header>
  );
}

function FinalCta({ funnel }: { funnel: FunnelState }) {
  const cta = getFunnelCta(funnel);
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-b border-ink bg-blue text-paper">
      <motion.div
        aria-hidden
        className="absolute -left-14 top-1/2 h-32 w-32 rounded-full border-[3px] border-ink bg-lime"
        animate={reduceMotion ? undefined : { rotate: [0, 8, 0], y: [-8, 8, -8] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute -right-8 top-16 h-28 w-28 rotate-12 rounded-[24px] border-[3px] border-ink bg-flame"
        animate={reduceMotion ? undefined : { rotate: [12, 2, 12], y: [0, 12, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative mx-auto max-w-[1240px] px-5 py-28 sm:px-8 sm:py-36">
        <div className="mx-auto max-w-4xl text-center">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-paper/60">Start the loop</p>
          <h2 className="m-0 mt-5 text-[clamp(3rem,7vw,6.8rem)] font-bold leading-[0.88] tracking-[-0.065em]">
            Content that compounds.
          </h2>
          <p className="mx-auto mb-0 mt-7 max-w-xl text-lg leading-8 text-paper/70">
            Draft, publish, reply, reach warm contacts, and feed every win back into your Brain.
          </p>
          <Link
            href={cta.href}
            className={`mt-9 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] border-2 border-ink bg-paper px-6 py-3 text-sm font-bold text-ink transition-transform hover:-translate-y-1 ${FOCUS}`}
          >
            {cta.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-paper/60">
            {['7 days free', 'Cancel anytime'].map((item) => (
              <span key={item} className="inline-flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-lime" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FooterMark() {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label="Content OS">
          <div className="flex items-center -space-x-1" aria-hidden>
            <span className="footer-mark-piece grid h-10 w-9 -rotate-3 place-items-center rounded-full border-2 border-ink bg-blue text-lg font-bold text-paper sm:h-12 sm:w-11 sm:text-xl">c</span>
            <span className="footer-mark-piece grid h-10 w-9 rotate-2 place-items-center rounded-full border-2 border-ink bg-lime text-lg font-bold text-ink sm:h-12 sm:w-11 sm:text-xl">o</span>
            <span className="footer-mark-piece grid h-10 w-9 -rotate-1 place-items-center rounded-[12px] border-2 border-ink bg-surface text-lg font-bold text-ink sm:h-12 sm:w-11 sm:text-xl">n</span>
            <span className="footer-mark-piece grid h-10 w-9 rotate-3 place-items-center rounded-full border-2 border-ink bg-flame text-lg font-bold text-ink sm:h-12 sm:w-11 sm:text-xl">t</span>
            <span className="footer-mark-piece grid h-10 w-9 -rotate-2 place-items-center rounded-[14px] border-2 border-ink bg-lilac text-lg font-bold text-ink sm:h-12 sm:w-11 sm:text-xl">e</span>
            <span className="footer-mark-piece grid h-10 w-9 rotate-1 place-items-center rounded-full border-2 border-ink bg-surface text-lg font-bold text-ink sm:h-12 sm:w-11 sm:text-xl">n</span>
            <span className="footer-mark-piece grid h-10 w-9 -rotate-3 place-items-center rounded-[12px] border-2 border-ink bg-ink text-lg font-bold text-paper sm:h-12 sm:w-11 sm:text-xl">t</span>
          </div>
          <div className="ml-2 flex items-center -space-x-1" aria-hidden>
            <span className="footer-mark-piece grid h-10 w-9 rotate-2 place-items-center rounded-full border-2 border-ink bg-lime text-lg font-bold text-ink sm:h-12 sm:w-11 sm:text-xl">o</span>
            <span className="footer-mark-piece grid h-10 w-9 -rotate-2 place-items-center rounded-[15px] border-2 border-ink bg-blue text-lg font-bold text-paper sm:h-12 sm:w-11 sm:text-xl">s</span>
            <span className="ml-6 mt-8 h-2.5 w-2.5 rounded-full border border-ink bg-flame" />
          </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-ink bg-paper">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <FooterMark />
        <div className="flex flex-wrap gap-5 text-sm text-ink3">
          <Link href="/pricing" className={`inline-flex min-h-11 items-center transition-colors hover:text-ink ${FOCUS}`}>Pricing</Link>
          <Link href="/terms" className={`inline-flex min-h-11 items-center transition-colors hover:text-ink ${FOCUS}`}>Terms</Link>
          <Link href="/privacy" className={`inline-flex min-h-11 items-center transition-colors hover:text-ink ${FOCUS}`}>Privacy</Link>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1240px] flex-col gap-2 border-t border-hair px-5 py-5 text-xs text-ink3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="m-0">Content and leads. One loop.</p>
        <p className="m-0">© 2026 Content OS</p>
      </div>
    </footer>
  );
}

export default function QuietLanding({ funnel }: { funnel: FunnelState }) {
  return (
    <LandingSmoothScroll>
      <main id="main-content" className="quiet-landing min-h-screen overflow-x-clip bg-paper text-ink">
        <SmoothCursor />
        <a
          href="#main-content"
          className="sr-only z-[100] focus:fixed focus:left-4 focus:top-4 focus:not-sr-only focus:rounded-[10px] focus:bg-ink focus:px-4 focus:py-3 focus:text-paper"
        >
          Skip to main content
        </a>
        <QuietNav funnel={funnel} />
        <Hero funnel={funnel} />
        <KineticPosterSections />
        <FinalCta funnel={funnel} />
        <Footer />
      </main>
    </LandingSmoothScroll>
  );
}
