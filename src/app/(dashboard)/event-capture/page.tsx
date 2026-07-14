'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { useInbox, dismissCapture } from './useEventCapture';
import { EventCaptureInbox } from './EventCaptureInbox';
import { EventDetailPanel } from './EventDetailPanel';

/**
 * Event Capture inbox page: the list of captured events on the left, the
 * selected capture's Q&A / draft detail on the right. Two-column on desktop,
 * stacked on mobile. Follows the Signals page layout so the two feeds match.
 */
export default function EventCapturePage() {
  const { items, loading, setup, refresh } = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleDismiss = async (id: string): Promise<void> => {
    await dismissCapture(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  const showSetupOnly = setup.setupRequired && items.length === 0 && !loading;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        eyebrow="Events"
        title="Event Capture"
        subtitle="Turn the events you attend into posts. Answer a few questions and we draft it in your voice."
      />

      {setup.setupRequired && (
        <div className="rounded-lg border border-border bg-bg-secondary px-4 py-3 text-sm">
          <p className="text-text-primary font-medium">
            {setup.message ?? 'Event capture is not ready yet - contact support'}
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            {setup.missing.includes('event_captures')
              ? 'The event_captures table is missing. An operator needs to apply the event capture migration.'
              : setup.missing.includes('composio')
                ? 'Connect Google Calendar in Settings to start capturing events.'
                : 'Ask support to finish provisioning this feature.'}
            {setup.missing.includes('composio') && (
              <>
                {' '}
                <Link href="/settings" className="text-accent-primary hover:underline">
                  Open Settings
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      {showSetupOnly ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-bg-secondary py-16 text-center px-6">
          <CalendarDays className="h-8 w-8 text-text-tertiary" />
          <p className="text-sm text-text-secondary max-w-md">
            {setup.missing.includes('composio')
              ? 'Connect a calendar to capture events you attend.'
              : 'Event capture is not available on this deployment yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
          <div className="lg:col-span-2 border border-border rounded-lg bg-bg-secondary overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium text-text-secondary">
              <CalendarDays className="h-4 w-4" />
              Inbox
              {!loading && <span className="text-text-tertiary">({items.length})</span>}
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {loading && items.length === 0 ? (
                <p className="p-4 text-sm text-text-tertiary">Loading events…</p>
              ) : (
                <EventCaptureInbox
                  items={items}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onDismiss={handleDismiss}
                />
              )}
            </div>
          </div>

          <div className="lg:col-span-3 border border-border rounded-lg bg-bg-secondary p-5">
            {selectedId ? (
              <EventDetailPanel key={selectedId} id={selectedId} onSubmitted={refresh} />
            ) : (
              <p className="text-sm text-text-tertiary">Select an event to review.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
