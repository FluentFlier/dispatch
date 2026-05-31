import Link from 'next/link';
import { ArrowRight, FolderOpen, MessageCircle, PenLine, Sparkles } from 'lucide-react';

const actions = [
  {
    title: 'Write a post',
    description: 'AI drafts in your voice. You edit and approve.',
    href: '/generate',
    icon: PenLine,
    accent: 'bg-coral-light text-accent-primary',
  },
  {
    title: 'My posts',
    description: 'See drafts, scheduled, and published content.',
    href: '/library',
    icon: FolderOpen,
    accent: 'bg-sage-light text-accent-secondary',
  },
  {
    title: 'Reply to comments',
    description: 'All comments in one place. Draft replies quickly.',
    href: '/inbox',
    icon: MessageCircle,
    accent: 'bg-bg-tertiary text-text-secondary',
  },
  {
    title: 'Research & Intelligence',
    description: 'Live high-converting hooks + lead categorization from real data.',
    href: '/analytics#intelligence',
    icon: Sparkles,
    accent: 'bg-amber-100 text-amber-700',
  },
];

export function QuickActions() {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-4 gap-2">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex min-h-[116px] flex-col justify-between rounded-lg border border-border bg-bg-secondary p-4 shadow-card hover:-translate-y-0.5 hover:border-border-hover hover:shadow-soft transition-all"
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
