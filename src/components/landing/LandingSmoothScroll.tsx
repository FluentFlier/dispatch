'use client';

import { ReactLenis } from 'lenis/react';
import { useEffect, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';

interface Props {
  children: ReactNode;
}

export default function LandingSmoothScroll({ children }: Props) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    document.documentElement.classList.add('lenis', 'lenis-smooth');
    return () => {
      document.documentElement.classList.remove('lenis', 'lenis-smooth');
    };
  }, [reduce]);

  if (reduce) {
    return <>{children}</>;
  }

  return (
    <ReactLenis
      root
      options={{
        duration: 1.15,
        easing: (t: number) => 1 - (1 - t) ** 4,
        smoothWheel: true,
        wheelMultiplier: 0.85,
        touchMultiplier: 1.1,
      }}
    >
      {children}
    </ReactLenis>
  );
}
