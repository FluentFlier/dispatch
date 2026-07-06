'use client';

import { useState } from 'react';
import EngagementInbox from '@/components/engagement/EngagementInbox';
import WarmContactsPanel from '@/components/engagement/WarmContactsPanel';
import { PageHeader } from '@/components/layout/PageHeader';

type InboxTab = 'comments' | 'warm';

export default function InboxPage() {
  const [tab, setTab] = useState<InboxTab>('comments');

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="INBOX"
        title={tab === 'comments' ? 'Comments' : 'Warm contacts'}
        subtitle={
          tab === 'comments'
            ? 'Replies on your posts, in one place. Draft in your voice, then approve to send.'
            : 'People engaging your posts — triage ICPs and draft connection notes.'
        }
      />

      <div className="flex gap-2 mb-6 border-b border-border">
        {(
          [
            ['comments', 'Comments'],
            ['warm', 'Warm contacts'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-accent-primary text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'comments' ? <EngagementInbox /> : <WarmContactsPanel />}
    </div>
  );
}
