'use client';

import { useState } from 'react';
import EngagementInbox from '@/components/engagement/EngagementInbox';
import OutboundQueue from '@/components/engagement/OutboundQueue';
import WarmContactsPanel from '@/components/engagement/WarmContactsPanel';
import LoopReadinessCard from '@/components/engagement/LoopReadinessCard';
import { PageHeader } from '@/components/layout/PageHeader';

type InboxTab = 'replies' | 'warm' | 'outbound';

const TAB_COPY: Record<InboxTab, { title: string; subtitle: string }> = {
  replies: {
    title: 'Replies',
    subtitle: 'Comments on your posts. Draft in your voice, then approve to send.',
  },
  warm: {
    title: 'Warm contacts',
    subtitle: 'People engaging your posts - triage ICPs and draft connection notes.',
  },
  outbound: {
    title: 'Outbound',
    subtitle: 'Comment on others’ posts at human pace - draft, approve, cron sends.',
  },
};

export default function InboxPage() {
  const [tab, setTab] = useState<InboxTab>('replies');
  const copy = TAB_COPY[tab];

  return (
    <div className="page-shell">
      <PageHeader eyebrow="INBOX" title={copy.title} subtitle={copy.subtitle} />

      <div className="mb-6">
        <LoopReadinessCard />
      </div>

      <div className="flex gap-2 mb-6 border-b border-border">
        {(
          [
            ['replies', 'Replies'],
            ['warm', 'Warm'],
            ['outbound', 'Outbound'],
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

      {tab === 'replies' && <EngagementInbox />}
      {tab === 'warm' && <WarmContactsPanel />}
      {tab === 'outbound' && <OutboundQueue />}
    </div>
  );
}
