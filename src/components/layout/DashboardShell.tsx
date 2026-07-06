'use client';

import type { ReactNode } from 'react';
import LandingGrain from '@/components/landing/LandingGrain';

interface Props {
  children: ReactNode;
}

/** Editorial app chrome — paper surface, subtle Silk Signal glow, film grain. */
export default function DashboardShell({ children }: Props) {
  return (
    <div className="editorial relative flex h-screen min-h-screen bg-paper text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-[8%] h-[380px] w-[380px] rounded-full bg-blue/10 blur-[100px] animate-land-drift-a" />
        <div className="absolute -right-24 top-[38%] h-[300px] w-[300px] rounded-full bg-teal/8 blur-[90px] animate-land-drift-b" />
        <div className="absolute bottom-[12%] left-[28%] h-[240px] w-[240px] rounded-full bg-blue/6 blur-[80px] animate-land-drift-c" />
      </div>
      <LandingGrain />
      <div className="relative z-10 flex min-h-0 w-full flex-1">{children}</div>
    </div>
  );
}
