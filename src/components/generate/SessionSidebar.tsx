import { useState, type ComponentType } from 'react';
import { ChevronDown, Loader2, Plus, PanelRight, PanelRightOpen, Trash2 } from 'lucide-react';
import { formatRelative } from '@/lib/utils';
import type { ChatSummary } from '@/lib/chats-status';

const STAGE_LABELS: Record<string, string> = {
  thinking: 'Thinking…',
  writing: 'Writing…',
  revising: 'Revising…',
  polishing: 'Polishing…',
  scoring: 'Scoring…',
};

/**
 * Shell shared by both states, mirroring the main nav rail in `nav/Sidebar.tsx`:
 * same widths (264 open / 72 collapsed). `fixed inset-y-0 right-0` pins the rail
 * to the viewport edge - escaping the dashboard main's padding and its centered
 * max-w wrapper, which otherwise leave gaps on every side. No surface color:
 * the shell stays transparent so the dashboard's silk ambient shows through,
 * same as the main write column. The host page reserves the width via
 * padding-right (see ScriptGenerator's root).
 */
const SHELL =
  'hidden shrink-0 flex-col lg:flex fixed inset-y-0 right-0 z-30 border-l border-hair py-4';

/** Icon-button treatment copied from the main sidebar's toggle, so both rails feel like one system. */
const ACTION =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30';

/** A secondary Write tool surfaced in the sidebar's "More tools" dropdown. */
export interface WriteTool {
  id: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

interface SessionSidebarProps {
  chats: ChatSummary[];
  activeId: string | null;
  collapsed: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggleCollapsed: () => void;
  tools: WriteTool[];
  onSelectTool: (id: string) => void;
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
  tools,
  onSelectTool,
}: SessionSidebarProps): JSX.Element {
  const runningCount = chats.filter((c) => c.status === 'running').length;
  const [toolsOpen, setToolsOpen] = useState(false);

  if (collapsed) {
    return (
      <div className={`${SHELL} w-[72px] items-center gap-2 px-3`}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sessions"
          title="Expand sessions"
          className={`relative ${ACTION}`}
        >
          <PanelRightOpen className="h-5 w-5" strokeWidth={2.5} />
          {runningCount > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent-primary" />
          )}
        </button>
        <button
          type="button"
          onClick={onNew}
          aria-label="New session"
          title="New session"
          className={ACTION}
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <aside className={`${SHELL} w-[264px] px-3`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-base font-semibold tracking-[-0.02em] text-ink">Sessions</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            aria-label="New session"
            title="New session"
            className={ACTION}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sessions"
            title="Collapse sessions"
            className={ACTION}
          >
            <PanelRight className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="-mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
        {loading && chats.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-ink2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {!loading && chats.length === 0 && (
          <p className="px-3 py-2 text-sm text-ink2">No sessions yet.</p>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
              chat.id === activeId
                ? 'border border-hair2 bg-white/80 text-ink shadow-sm backdrop-blur-sm'
                : 'hover:bg-white/60'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(chat.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-sm font-medium text-ink">{chat.title}</span>
              <span className="flex items-center gap-1.5 text-[13px] text-ink2">
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

      {/* More tools: bottom of the rail. The shell is fixed inset-y-0 (exact
          viewport height) and this block sits above the shell's bottom padding,
          so it can't render below the fold. Expanding opens upward-safe: the
          sessions list above it scrolls, this block never leaves the screen. */}
      {tools.length > 0 && (
        <div
          className="mt-4 shrink-0 border-t border-hair pb-2 pt-4"
          onMouseEnter={() => setToolsOpen(true)}
        >
          <button
            type="button"
            onClick={() => setToolsOpen((o) => !o)}
            aria-expanded={toolsOpen}
            className="flex min-h-[38px] w-full items-center justify-between gap-3 rounded-lg px-3 text-sm font-medium text-ink transition-colors hover:bg-white/60"
          >
            More tools
            <ChevronDown className={`h-4 w-4 shrink-0 text-ink3 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
          </button>
          {toolsOpen && (
            <div className="mt-1 max-h-[40vh] space-y-0.5 overflow-y-auto pb-1 pl-2">
              {tools.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectTool(t.id)}
                  className="group flex min-h-[38px] w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-white/60"
                >
                  <t.icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.label}</span>
                    <span className="block truncate text-[13px] text-ink2">{t.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
