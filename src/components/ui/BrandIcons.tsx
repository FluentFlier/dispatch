import type { SVGProps } from 'react';

/**
 * Y Combinator wordmark: orange rounded square with a white "Y".
 * Sized via className (e.g. "h-4 w-4"); brand orange is intrinsic.
 */
export function YCLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...props}>
      <rect width="24" height="24" rx="3" fill="#FB651E" />
      <path
        d="M7 6.5 L12 12 L17 6.5 M12 12 L12 18"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * X (formerly Twitter) logo. Inherits color via currentColor, so it adapts to
 * the surrounding text color like the lucide icons it replaces.
 */
export function XLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
