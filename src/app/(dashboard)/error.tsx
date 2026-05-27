'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <AlertTriangle className="w-12 h-12 text-accent-primary mb-4" />
      <h2 className="font-heading text-[22px] font-semibold text-text-primary mb-2">
        Something went wrong
      </h2>
      <p className="text-text-secondary text-[13px] mb-6 max-w-md">
        An unexpected error occurred while loading this page. Please try again.
      </p>
      <button
        onClick={reset}
        className="flex items-center gap-1.5 bg-accent-primary text-text-inverse text-[13px] font-medium px-5 py-[10px] rounded-md hover:bg-accent-dark transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Try Again
      </button>
    </div>
  );
}
