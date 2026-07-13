import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';

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
    <section className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-amber-700 shrink-0" />
        <span className="section-label text-amber-800">Action needed</span>
        <span className="ml-auto text-xs text-ink3 tabular-nums">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200/70 bg-white/90 p-3 backdrop-blur-sm"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{item.title}</p>
              <p className="text-xs text-ink2 mt-0.5">{item.detail}</p>
            </div>
            <Link
              href={item.href}
              className="inline-flex items-center justify-center gap-1.5 shrink-0 text-sm font-medium text-amber-800 hover:text-amber-950 px-4 py-2 rounded-full border border-amber-300 bg-amber-100/60 min-h-[40px]"
            >
              {item.actionLabel ?? 'Fix now'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
