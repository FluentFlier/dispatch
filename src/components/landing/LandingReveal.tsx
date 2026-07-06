'use client';

import { type ReactNode, useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';

interface Props {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export default function LandingReveal({
  children,
  className = '',
  delay = 0,
  y = 32,
}: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.12, margin: '-40px 0px -40px 0px' });

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
