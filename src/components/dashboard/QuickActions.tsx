import Link from 'next/link';
import { ArrowRight, CalendarDays, FolderOpen, MessageCircle, PenLine, Radio } from 'lucide-react';

const actions = [
  {
    title: 'Check signals',
    description: 'Draft outreach when founders you follow raise.',
    href: '/signals',
    icon: Radio,
    accent: 'bg-coral-light text-accent-primary',
  },
  {
    title: 'Write a post',
    description: 'Start a draft in your voice.',
    href: '/generate',
    icon: PenLine,
    accent: 'bg-sage-light text-accent-secondary',
  },
  {
    title: 'My posts',
    description: 'Drafts, scheduled, and published.',
    href: '/library',
    icon: FolderOpen,
    accent: 'bg-bg-tertiary text-text-secondary',
  },
  {
    title: 'Reply to comments',
    description: 'One inbox for every platform.',
    href: '/inbox',
    icon: MessageCircle,
    accent: 'bg-bg-tertiary text-text-secondary',
  },
];

export function QuickActions() {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex min-h-[100px] flex-col justify-between rounded-lg border border-border bg-bg-secondary p-4 shadow-card hover:-translate-y-0.5 hover:border-border-hover hover:shadow-soft transition-all"
        >
          <div className="flex items-start justify-between gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-md ${action.accent}`}
            >
              <action.icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary group-hover:text-accent-primary transition-colors">
              {action.title}
            </h2>
            <p className="mt-1 text-xs text-text-secondary leading-snug">
              {action.description}
            </p>
          </div>
        </Link>
      ))}
    </section>
  );
}
