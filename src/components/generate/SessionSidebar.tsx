import { Loader2, Plus, PanelRightClose, PanelRightOpen, Trash2 } from 'lucide-react';
import { formatRelative } from '@/lib/utils';
import type { ChatSummary } from '@/lib/chats-status';

const STAGE_LABELS: Record<string, string> = {
  thinking: 'Thinking…',
  writing: 'Writing…',
  revising: 'Revising…',
  polishing: 'Polishing…',
  scoring: 'Scoring…',
};

interface SessionSidebarProps {
  chats: ChatSummary[];
  activeId: string | null;
  collapsed: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggleCollapsed: () => void;
}

/**
 * Right-hand list of Write sessions (desktop/tablet). Sessions generating in the
 * background show a live spinner + stage; a session that outran its function
 * budget shows as stalled. Collapses to a thin rail with a running-count dot.
 */
export function SessionSidebar({
  chats,
  activeId,
  collapsed,
  loading,
  onSelect,
  onNew,
  onDelete,
  onToggleCollapsed,
}: SessionSidebarProps): JSX.Element {
  const runningCount = chats.filter((c) => c.status === 'running').length;

  if (collapsed) {
    return (
      <div className="hidden w-11 shrink-0 flex-col items-center gap-2 border-l border-hair pl-2 lg:flex">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sessions"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-paper2 hover:text-ink2"
        >
          <PanelRightOpen className="h-4 w-4" />
          {runningCount > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent-primary" />
          )}
        </button>
        <button
          type="button"
          onClick={onNew}
          aria-label="New session"
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-paper2 hover:text-ink2"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-hair pl-3 lg:flex">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink2">Sessions</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            aria-label="New session"
            title="New session"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-paper2 hover:text-ink2"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sessions"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-paper2 hover:text-ink2"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto">
        {loading && chats.length === 0 && (
          <div className="flex items-center gap-2 px-2 py-2 text-[13px] text-ink3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
        {!loading && chats.length === 0 && (
          <p className="px-2 py-2 text-[13px] text-ink3">No sessions yet.</p>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-paper2 ${
              chat.id === activeId ? 'bg-paper2' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(chat.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[13px] text-ink2">{chat.title}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-ink3">
                {chat.status === 'running' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-accent-primary" />
                    {STAGE_LABELS[chat.stage ?? 'writing'] ?? 'Writing…'}
                  </>
                ) : chat.status === 'stalled' ? (
                  <span className="text-flame">Stalled</span>
                ) : (
                  formatRelative(chat.updated_at)
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(chat.id)}
              aria-label={`Delete "${chat.title}"`}
              className="hidden rounded p-1 text-ink3 transition-colors hover:text-accent-primary group-hover:block"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
