'use client';

import { MotionConfig } from 'motion/react';
import SmoothScroll from './SmoothScroll';
import LandingNav from './LandingNav';
import Hero from './Hero';
import PostReceipts from './PostReceipts';
import TheLoop from './TheLoop';
import ProductShowcase from './ProductShowcase';
import VoiceFingerprint from './VoiceFingerprint';
import NativeEverywhere from './NativeEverywhere';
import WhatCompounds from './WhatCompounds';
import FinalCTA from './FinalCTA';
import SiteFooter from './SiteFooter';

interface Props {
  loggedIn: boolean;
}

export default function LandingPageContent({ loggedIn }: Props) {
  return (
    <MotionConfig reducedMotion="user">
      <SmoothScroll>
        <main className="os-landing os-grain relative min-h-screen overflow-x-hidden">
          <LandingNav loggedIn={loggedIn} />
          <Hero loggedIn={loggedIn} />
          <PostReceipts />
          <TheLoop />
          <ProductShowcase />
          <VoiceFingerprint />
          <NativeEverywhere />
          <WhatCompounds />
          <FinalCTA loggedIn={loggedIn} />
          <SiteFooter />
        </main>
      </SmoothScroll>
    </MotionConfig>
  );
}
