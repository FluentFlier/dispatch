'use client';

import { motion, useScroll, useSpring } from 'motion/react';

/** Thin oil-slick beam at the very top that fills as you scroll the page. */
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-os-coral via-os-gold to-os-cyan"
    />
  );
}
