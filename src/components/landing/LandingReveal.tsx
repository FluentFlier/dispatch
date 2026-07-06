'use client';

import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

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

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
