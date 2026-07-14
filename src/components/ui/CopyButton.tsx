'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';

interface CopyButtonProps {
  text: string;
  className?: string;
}

/**
 * Fallback for when the async Clipboard API is blocked (permission denied,
 * unsupported browser, embedded/iframe context) -- the older execCommand path
 * still works in those cases since it doesn't need clipboard-write permission.
 */
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (!legacyCopy(text)) {
        toast('Copy failed - select and copy the text manually.', 'error');
        return;
      }
    }
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
