'use client';

import { useEffect, useRef } from 'react';
import { getCalendlyUrl } from '@/lib/calendly';

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: { url: string; parentElement: HTMLElement }) => void;
    };
  }
}

interface Props {
  className?: string;
}

/**
 * Renders the Calendly inline booking widget when NEXT_PUBLIC_CALENDLY_URL is set.
 */
export default function CalendlyEmbed({ className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const url = getCalendlyUrl();

  useEffect(() => {
    if (!url || !containerRef.current) return;

    function init() {
      if (!containerRef.current || !window.Calendly) return;
      containerRef.current.innerHTML = '';
      window.Calendly.initInlineWidget({ url, parentElement: containerRef.current });
    }

    if (window.Calendly) {
      init();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.async = true;
    script.onload = init;
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [url]);

  if (!url) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg-secondary p-8 text-center text-sm text-text-secondary">
        <p className="font-medium text-text-primary">Calendly link not configured</p>
        <p className="mt-2">
          Add <code className="text-xs">NEXT_PUBLIC_CALENDLY_URL</code> to your environment.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className ?? 'calendly-inline-widget min-h-[680px] w-full'}
      data-url={url}
    />
  );
}
