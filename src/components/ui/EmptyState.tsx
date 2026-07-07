import type { ReactNode } from 'react';
import Link from 'next/link';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}

/**
 * Consistent empty state: dashed border, icon slot, title, body, optional CTAs.
 */
export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="empty-state flex flex-col items-center text-center">
      {icon ? <div className="mb-3 text-ink3">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-md">{description}</p>
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export function EmptyStateLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`text-sm font-medium text-blue hover:underline ${className}`}>
      {children}
    </Link>
  );
}
