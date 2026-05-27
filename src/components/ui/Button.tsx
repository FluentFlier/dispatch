'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Skeleton } from './Skeleton';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-accent-primary text-text-inverse border border-transparent shadow-soft hover:bg-accent-dark',
  secondary:
    'bg-bg-secondary border border-border text-text-primary hover:bg-bg-tertiary',
  ghost:
    'bg-transparent border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-3 py-2 text-sm min-h-[40px]',
  md: 'px-5 py-2.5 text-[15px] min-h-[44px]',
  lg: 'px-6 py-3.5 text-base min-h-[52px] font-semibold',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      className = '',
      children,
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-md font-body font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...rest}
      >
        {loading && <Skeleton className="h-4 w-4 rounded" />}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
export { Button };
export type { ButtonProps };
