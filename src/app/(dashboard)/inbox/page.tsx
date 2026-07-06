'use client';

import EngagementInbox from '@/components/engagement/EngagementInbox';
import OutboundQueue from '@/components/engagement/OutboundQueue';
import { PageHeader } from '@/components/layout/PageHeader';

export default function InboxPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="INBOX"
        title="Comments"
        subtitle="Replies on your posts, in one place. Draft in your voice, then approve to send."
      />
      <EngagementInbox />
      <OutboundQueue />
    </div>
  );
}
