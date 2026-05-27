import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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
    <section className="bg-[#09090B] border-[0.5px] border-[rgba(239,68,68,0.35)] rounded-[12px] p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-[#F87171]" />
        <span className="text-[12px] font-medium text-[#FAFAFA]">Needs attention</span>
        <span className="text-[10px] text-[#71717A] ml-auto">{items.length} issue{items.length > 1 ? 's' : ''}</span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-[8px] bg-[#18181B] border-[0.5px] border-[#FAFAFA]/08"
          >
            <div className="min-w-0">
              <p className="text-[13px] text-[#FAFAFA] font-medium">{item.title}</p>
              <p className="text-[11px] text-[#71717A] mt-0.5 truncate">{item.detail}</p>
            </div>
            <Link
              href={item.href}
              className="inline-flex items-center gap-1.5 shrink-0 text-[11px] text-[#818CF8] hover:text-[#A5B4FC] px-3 py-1.5 rounded-[6px] border border-[#818CF8]/25"
            >
              <RefreshCw size={12} />
              {item.actionLabel ?? 'Fix'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
