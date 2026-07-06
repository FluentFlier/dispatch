'use client';

import Image from 'next/image';
import { useReducedMotion } from 'motion/react';

interface Props {
  /** Landing = full silk in hero; dashboard = softer wash for app chrome. */
  variant?: 'landing' | 'dashboard';
}

/** Fixed silk fabric background — hero-bg, mesh overlay, drift orbs. */
export default function SilkAmbient({ variant = 'landing' }: Props) {
  const reduce = useReducedMotion();
  const dashboard = variant === 'dashboard';

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <Image
        src="/landing/hero-bg.png"
        alt=""
        fill
        priority={!dashboard}
        className={`object-cover object-[center_28%] scale-105 ${reduce ? '' : 'animate-land-kenburns'}`}
        sizes="100vw"
      />
      <div
        className={`absolute inset-0 bg-gradient-to-b ${
          dashboard
            ? 'from-paper/55 via-paper/82 to-paper'
            : 'from-paper/5 via-paper/35 to-paper'
        }`}
      />

      {!reduce && (
        <>
          <div className="absolute -left-32 top-[18%] h-[420px] w-[420px] rounded-full bg-blue/12 blur-[100px] animate-land-drift-a" />
          <div className="absolute -right-24 top-[42%] h-[360px] w-[360px] rounded-full bg-teal/10 blur-[90px] animate-land-drift-b" />
          <div className="absolute bottom-[8%] left-[30%] h-[280px] w-[280px] rounded-full bg-blue/8 blur-[80px] animate-land-drift-c" />
        </>
      )}

      <div
        className={`absolute inset-0 mix-blend-soft-light ${dashboard ? 'opacity-20' : 'opacity-[0.35]'}`}
      >
        <Image
          src="/landing/mesh.png"
          alt=""
          fill
          className={`object-cover object-center ${reduce ? '' : 'animate-land-mesh'}`}
          sizes="100vw"
        />
      </div>
    </div>
  );
}
