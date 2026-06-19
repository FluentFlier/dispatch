'use client';

import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

/**
 * Per-section atmospheric light. Two oil-slick radial glows that drift on scroll
 * so moving down the page feels like passing through lit chambers rather than
 * flat black. Brand palette only (coral / cyan / gold / lime); decorative, sits
 * behind content (pair with `relative z-10` on the section's content wrapper).
 */
const GLOW: Record<string, string> = {
  coral: 'rgba(255,107,74,0.22)',
  cyan: 'rgba(91,231,216,0.17)',
  gold: 'rgba(215,181,109,0.16)',
  lime: 'rgba(184,243,106,0.15)',
};

export default function SectionAtmosphere({
  tone = 'coral',
  accent = 'cyan',
  position = 'left',
  className = '',
}: {
  tone?: keyof typeof GLOW;
  accent?: keyof typeof GLOW;
  position?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const yMain = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [80, -80]);
  const yAccent = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [-60, 60]);

  const mainPos =
    position === 'right'
      ? 'right-[-14%]'
      : position === 'center'
        ? 'left-1/2 -translate-x-1/2'
        : 'left-[-14%]';
  const accentPos = position === 'right' ? 'left-[-10%]' : 'right-[-10%]';

  return (
    <div
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
    >
      <motion.div
        style={{
          y: yMain,
          background: `radial-gradient(circle at center, ${GLOW[tone]}, transparent 64%)`,
        }}
        className={`absolute top-[4%] ${mainPos} h-[46vw] w-[46vw] rounded-full blur-[130px]`}
      />
      <motion.div
        style={{
          y: yAccent,
          background: `radial-gradient(circle at center, ${GLOW[accent]}, transparent 66%)`,
        }}
        className={`absolute bottom-0 ${accentPos} h-[38vw] w-[38vw] rounded-full blur-[140px]`}
      />
    </div>
  );
}
