'use client';

import LandingAmbient from './LandingAmbient';
import LandingGrain from './LandingGrain';
import LandingReveal from './LandingReveal';
import LandingPhotoBand from './LandingPhotoBand';
import LandingSmoothScroll from './LandingSmoothScroll';
import Nav from './editorial/Nav';
import Hero from './editorial/Hero';
import Problem from './editorial/Problem';
import Loop from './editorial/Loop';
import Distribution from './editorial/Distribution';
import Different from './editorial/Different';
import Week from './editorial/Week';
import Icp from './editorial/Icp';
import LandingCta from './LandingCta';
import Footer from './editorial/Footer';
import type { FunnelState } from '@/lib/funnel-cta';

interface Props {
  funnel: FunnelState;
}

export default function LandingPageContent({ funnel }: Props) {
  return (
    <LandingSmoothScroll>
      <main className="editorial relative min-h-screen overflow-x-hidden bg-paper text-ink">
        <LandingAmbient />
        <LandingGrain />
        <a
          href="#loop"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <div className="relative z-10">
          <Nav funnel={funnel} />
          <Hero funnel={funnel} />
          <LandingReveal>
            <Problem />
          </LandingReveal>
          <LandingPhotoBand src="/landing/mesh.png" height="sm" />
          <LandingReveal delay={0.05}>
            <Loop />
          </LandingReveal>
          <LandingReveal delay={0.05}>
            <Distribution />
          </LandingReveal>
          <LandingReveal delay={0.05}>
            <Different />
          </LandingReveal>
          <LandingReveal>
            <Week />
          </LandingReveal>
          <LandingReveal delay={0.05}>
            <Icp />
          </LandingReveal>
          <LandingReveal>
            <LandingCta funnel={funnel} />
          </LandingReveal>
          <Footer />
        </div>
      </main>
    </LandingSmoothScroll>
  );
}
