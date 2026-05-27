'use client';

import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className={`px-[14px] py-[7px] text-[13px] font-body font-medium rounded-md bg-transparent border border-border text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-all duration-100 ${className}`}
    >
      {copied ? (
        <span className="inline-flex items-center gap-1">
          <svg
            className="w-3.5 h-3.5 text-accent-secondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </span>
      ) : (
        'Copy'
      )}
    </button>
  );
}
