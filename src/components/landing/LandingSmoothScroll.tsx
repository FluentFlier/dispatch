'use client';

import { useEffect, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';

interface Props {
  children: ReactNode;
}

export default function LandingSmoothScroll({ children }: Props) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;

    let lenis: { raf: (time: number) => void; destroy: () => void } | null = null;
    let frame = 0;
    let cancelled = false;

    void (async () => {
      const { default: Lenis } = await import('lenis');
      if (cancelled) return;

      lenis = new Lenis({
        duration: 1.15,
        easing: (t: number) => 1 - (1 - t) ** 4,
        smoothWheel: true,
        wheelMultiplier: 0.85,
        touchMultiplier: 1.1,
      });

      document.documentElement.classList.add('lenis', 'lenis-smooth');

      const raf = (time: number) => {
        lenis?.raf(time);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      lenis?.destroy();
      document.documentElement.classList.remove('lenis', 'lenis-smooth');
    };
  }, [reduce]);

  return <>{children}</>;
}
