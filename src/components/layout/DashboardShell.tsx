'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/nav/Sidebar';
import BottomBar from '@/components/nav/BottomBar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

/** Routes that render without app chrome (full-bleed). */
function isMinimalChromeRoute(pathname: string): boolean {
  return pathname === '/teleprompter' || pathname === '/onboarding' || pathname.startsWith('/onboarding/');
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isMinimalChromeRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen min-h-screen bg-bg-primary text-text-primary">
      <Sidebar />
      <main className="flex-1 md:ml-[264px] overflow-y-auto overflow-x-hidden px-4 md:px-8 py-6 pb-24 md:pb-8 min-w-0 w-full">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <BottomBar />
    </div>
  );
}
