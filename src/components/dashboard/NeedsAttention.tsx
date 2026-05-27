import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

export interface AttentionItem {
  id: string;
  type: 'publish_failed' | 'auth_expired' | 'billing';
  title: string;
  detail: string;
  href: string;
  actionLabel?: string;
}

export default function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-red-200 bg-red-50/80 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-red-600 shrink-0" />
        <span className="text-sm font-semibold text-text-primary">Needs your attention</span>
        <span className="text-xs text-text-tertiary ml-auto">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-md bg-bg-secondary border border-border"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{item.title}</p>
              <p className="text-xs text-text-secondary mt-0.5">{item.detail}</p>
            </div>
            <Link
              href={item.href}
              className="inline-flex items-center justify-center shrink-0 text-sm font-medium text-accent-primary hover:text-accent-dark px-4 py-2 rounded-md border border-accent-primary/30 bg-coral-light min-h-[44px]"
            >
              {item.actionLabel ?? 'Fix now'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
