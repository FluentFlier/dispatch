'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, ChevronsUpDown, Plus, User } from 'lucide-react';

interface Ws {
  id: string;
  name: string;
  type: 'solo' | 'client';
}

export default function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/workspaces', { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return;
      const d = await res.json();
      setWorkspaces(d.workspaces ?? []);
      setActiveId(d.activeId ?? null);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    load();
  }, []);

  const active =
    workspaces.find((w) => w.id === activeId) ??
    workspaces.find((w) => w.type === 'solo') ??
    workspaces[0];

  const switchTo = async (id: string) => {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ workspaceId: id }),
      });
      if (res.ok) {
        setActiveId(id);
        setOpen(false);
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const createClient = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: newName.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Could not add client');
        return;
      }
      setNewName('');
      setAdding(false);
      if (d.workspace?.id) {
        setActiveId(d.workspace.id);
        window.location.reload();
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!active) return null;

  return (
    <div className="relative mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-hair bg-white/70 px-3 py-2 text-left transition-colors hover:border-hair2 hover:bg-white"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hair bg-paper2">
          {active.type === 'client' ? (
            <Building2 className="h-3.5 w-3.5 text-ink2" />
          ) : (
            <User className="h-3.5 w-3.5 text-ink2" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] tracking-wide text-ink3">
            {active.type === 'client' ? 'Client' : 'Workspace'}
          </span>
          <span className="block truncate text-sm font-medium text-ink">{active.name}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-hair bg-white p-1 shadow-[0_20px_50px_-30px_rgba(23,23,23,0.25)]">
            <div className="max-h-64 overflow-auto">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={busy}
                  onClick={() => switchTo(w.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink2 transition-colors hover:bg-paper2 disabled:opacity-50"
                >
                  {w.type === 'client' ? (
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-ink3" />
                  ) : (
                    <User className="h-3.5 w-3.5 shrink-0 text-ink3" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === active.id && <Check className="h-3.5 w-3.5 shrink-0 text-blue" />}
                </button>
              ))}
            </div>

            <div className="mt-1 border-t border-hair pt-1">
              {adding ? (
                <div className="p-1.5">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createClient();
                      if (e.key === 'Escape') {
                        setAdding(false);
                        setError(null);
                      }
                    }}
                    placeholder="Client name"
                    className="w-full rounded-lg border border-hair bg-paper px-2.5 py-1.5 text-sm text-ink placeholder:text-ink3 focus:border-blue/40 focus:outline-none"
                  />
                  {error && <p className="mt-1 px-0.5 text-[11px] text-flame">{error}</p>}
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy || !newName.trim()}
                      onClick={createClient}
                      className="flex-1 rounded-lg bg-ink px-2 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
                    >
                      {busy ? 'Adding...' : 'Add client'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setError(null);
                      }}
                      className="rounded-lg px-2 py-1.5 text-[12px] text-ink3 hover:text-ink2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink2 transition-colors hover:bg-paper2"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  Add a client workspace
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
