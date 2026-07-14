import Link from 'next/link';
import { ArrowRight, FolderOpen, MessageCircle, PenLine, Sparkles } from 'lucide-react';

const actions = [
  {
    title: 'Write a post',
    description: 'AI drafts in your voice. You edit and approve.',
    href: '/generate',
    icon: PenLine,
    accent: 'bg-blue/10 text-blue',
  },
  {
    title: 'My posts',
    description: 'See drafts, scheduled, and published content.',
    href: '/library',
    icon: FolderOpen,
    accent: 'bg-blue/10 text-blue',
  },
  {
    title: 'Inbox',
    description: 'Comment replies and warm contacts from your posts.',
    href: '/inbox',
    icon: MessageCircle,
    accent: 'bg-lilac/15 text-lilac',
  },
  {
    title: 'Leads',
    description: 'GTM feed: signals, directory leads, and outreach.',
    href: '/leads',
    icon: Sparkles,
    accent: 'bg-flame/10 text-flame',
  },
];

export function QuickActions({ variant = 'row' }: { variant?: 'row' | 'rail' }) {
  const isRail = variant === 'rail';
  return (
    <section className={isRail ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3 lg:grid-cols-4'}>
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className={`group flex flex-col justify-between card-surface p-4 hover:-translate-y-0.5 hover:border-blue/20 transition-all ${isRail ? 'aspect-square' : 'min-h-[116px]'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full ${action.accent}`}
            >
              <action.icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <ArrowRight className="h-4 w-4 text-ink3 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ink group-hover:text-blue transition-colors">
              {action.title}
            </h2>
            <p className="mt-1 text-xs text-ink2 leading-snug">
              {action.description}
            </p>
          </div>
        </Link>
      ))}
    </section>
  );
}
