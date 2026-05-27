import Link from 'next/link';
import { PenLine, FolderOpen, MessageCircle } from 'lucide-react';

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
];

export function QuickActions() {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="group flex flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-5 shadow-card hover:border-accent-primary/40 hover:shadow-soft transition-all min-h-[120px]"
        >
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-md ${action.accent}`}
          >
            <action.icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary group-hover:text-accent-primary transition-colors">
              {action.title}
            </h2>
            <p className="mt-1 text-sm text-text-secondary leading-snug">
              {action.description}
            </p>
          </div>
        </Link>
      ))}
    </section>
  );
}
