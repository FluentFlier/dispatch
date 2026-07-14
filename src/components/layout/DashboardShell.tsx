'use client';

import type { ReactNode } from 'react';
import SilkAmbient from '@/components/landing/SilkAmbient';
import LandingGrain from '@/components/landing/LandingGrain';

interface Props {
  children: ReactNode;
}

/** Editorial app chrome - silk background, film grain. */
export default function DashboardShell({ children }: Props) {
  return (
    <div className="editorial relative flex h-screen min-h-screen bg-paper text-ink">
      <SilkAmbient variant="dashboard" />
      <LandingGrain />
      <div className="relative z-10 flex min-h-0 w-full flex-1">{children}</div>
    </div>
  );
}
