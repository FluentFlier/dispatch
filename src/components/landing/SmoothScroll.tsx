'use client';

import { ReactLenis } from 'lenis/react';
import type { ReactNode } from 'react';

/**
 * Lenis momentum scroll, scoped to the landing. Restrained easing: the page
 * should feel expensive, not hyperactive. Honors prefers-reduced-motion by
 * letting Lenis fall back to native scroll when the user opts out.
 */
export default function SmoothScroll({ children }: { children: ReactNode }) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <ReactLenis
      root
      options={{
        lerp: reduced ? 1 : 0.085,
        duration: 1.2,
        smoothWheel: !reduced,
        wheelMultiplier: 0.9,
      }}
    >
      {children}
    </ReactLenis>
  );
}
