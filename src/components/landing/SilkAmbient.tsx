'use client';

import Image from 'next/image';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

interface Props {
  /** Landing = full silk in hero; dashboard = softer wash for app chrome. */
  variant?: 'landing' | 'dashboard';
}

/** Fixed silk fabric background — hero-bg, mesh, sheen sweep, drift orbs. */
export default function SilkAmbient({ variant = 'landing' }: Props) {
  const reduce = useReducedMotion();
  const dashboard = variant === 'dashboard';
  const { scrollY } = useScroll();
  const fabricY = useTransform(scrollY, [0, 800], [0, reduce ? 0 : 90]);
  const meshY = useTransform(scrollY, [0, 800], [0, reduce ? 0 : -50]);
  const fade = useTransform(scrollY, [0, 520], [1, dashboard ? 1 : 0.72]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity: dashboard ? 1 : fade }}
    >
      <motion.div
        className={`absolute inset-0 ${reduce ? '' : 'animate-land-silk-breathe'}`}
        style={{ y: dashboard ? 0 : fabricY }}
      >
        <Image
          src="/landing/hero-bg.png"
          alt=""
          fill
          priority={!dashboard}
          className={`object-cover object-[center_28%] scale-105 ${reduce ? '' : 'animate-land-kenburns'}`}
          sizes="100vw"
        />
      </motion.div>

      <div
        className={`absolute inset-0 bg-gradient-to-b ${
          dashboard
            ? 'from-paper/55 via-paper/82 to-paper'
            : 'from-paper/0 via-paper/25 to-paper/88'
        }`}
      />

      {!reduce && (
        <>
          <div className="absolute -left-32 top-[18%] h-[420px] w-[420px] rounded-full bg-blue/12 blur-[100px] animate-land-drift-a" />
          <div className="absolute -right-24 top-[42%] h-[360px] w-[360px] rounded-full bg-teal/10 blur-[90px] animate-land-drift-b" />
          <div className="absolute bottom-[8%] left-[30%] h-[280px] w-[280px] rounded-full bg-blue/8 blur-[80px] animate-land-drift-c" />

          {/* Specular sweep across the silk weave */}
          <div className="absolute inset-0 overflow-hidden mix-blend-soft-light">
            <div className="absolute -inset-y-1/2 -left-1/2 h-[200%] w-[45%] animate-land-silk-sheen bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          </div>

          {!dashboard && (
            <Image
              src="/landing/glow.png"
              alt=""
              width={640}
              height={640}
              className="pointer-events-none absolute -right-[8%] top-[6%] w-[min(52vw,520px)] opacity-40 mix-blend-screen animate-land-drift-a"
              aria-hidden
            />
          )}
        </>
      )}

      <motion.div
        className={`absolute inset-0 mix-blend-soft-light ${dashboard ? 'opacity-20' : 'opacity-[0.38]'}`}
        style={{ y: dashboard ? 0 : meshY }}
      >
        <Image
          src="/landing/mesh.png"
          alt=""
          fill
          className={`object-cover object-center ${reduce ? '' : 'animate-land-mesh'}`}
          sizes="100vw"
        />
      </motion.div>

      {/* Soft vignette so type stays crisp on bright silk */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,transparent_0%,rgba(251,250,247,0.15)_55%,rgba(251,250,247,0.55)_100%)]" />
    </motion.div>
  );
}
