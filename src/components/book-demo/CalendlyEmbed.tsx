'use client';

import { useEffect, useRef } from 'react';
import { getBookingUrl, isCalendlyUrl } from '@/lib/calendly';

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
 * Embeds Calendly URLs and links out to other supported booking providers.
 */
export default function CalendlyEmbed({ className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const url = getBookingUrl();
  const usesCalendly = isCalendlyUrl(url);

  useEffect(() => {
    if (!url || !usesCalendly || !containerRef.current) return;

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
  }, [url, usesCalendly]);

  if (!url) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg-secondary p-8 text-center text-sm text-text-secondary">
        <p className="font-medium text-text-primary">Booking link not configured</p>
        <p className="mt-2">
          Add <code className="text-xs">NEXT_PUBLIC_BOOKING_URL</code> to your environment.
        </p>
      </div>
    );
  }

  if (!usesCalendly) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-border bg-bg-primary p-8 text-center">
        <p className="font-serif text-2xl tracking-[-0.02em] text-text-primary">Choose a time that works</p>
        <p className="mt-3 max-w-sm text-sm leading-6 text-text-secondary">
          Open the scheduling calendar to pick an available 20-minute walkthrough.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary mt-6 inline-flex justify-center"
        >
          View available times
        </a>
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
