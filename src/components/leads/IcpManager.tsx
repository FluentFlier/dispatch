'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { Check, Loader2, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { IcpChat } from '@/components/leads/IcpChat';
import { IcpForm } from '@/components/leads/IcpForm';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import type { DirectorySettingsRow, IcpProfileRow } from '@/lib/signals/types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

interface IcpManagerProps {
  settings: DirectorySettingsRow | null;
  profiles: IcpProfileRow[];
  onProfilesChange: (profiles: IcpProfileRow[]) => void;
  onSettingsSaved: (settings: DirectorySettingsRow) => void;
  onDiscoveryComplete?: () => void;
  toast?: (message: string, type?: 'success' | 'error') => void;
}

/** Does the current working ICP (mirrored into settings) have anything to save? */
function settingsHasIcp(settings: DirectorySettingsRow | null): boolean {
  if (!settings) return false;
  return Boolean(
    settings.icp_description?.trim() ||
      (settings.icp_verticals?.length ?? 0) > 0 ||
      (settings.icp_keywords?.length ?? 0) > 0,
  );
}

/**
 * ICP workspace: refine the working ICP in chat, save it as a named profile, and
 * manage several saved ICPs - activate one, tick a set, and run discovery across them.
 */
export function IcpManager({
  settings,
  profiles,
  onProfilesChange,
  onSettingsSaved,
  onDiscoveryComplete,
  toast,
}: IcpManagerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Save-current-ICP inline form.
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  // Manual add/edit ICP form (null = closed, {profile:null} = create, {profile} = edit).
  const [formState, setFormState] = useState<{ profile: IcpProfileRow | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const activeId = useMemo(() => profiles.find((p) => p.is_active)?.id ?? null, [profiles]);

  // Seed the tick-selection with the active ICP so "discover" is usable at once.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size > 0) return prev;
      return activeId ? new Set([activeId]) : prev;
    });
  }, [activeId]);

  const canSave = settingsHasIcp(settings);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveCurrent = async () => {
    const name = saveName.trim();
    if (!name || !settings) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/leads/icp/profiles', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          name,
          description: settings.icp_description,
          verticals: settings.icp_verticals ?? [],
          keywords: settings.icp_keywords ?? [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('save failed');
      onProfilesChange(data.profiles as IcpProfileRow[]);
      toast?.(`Saved “${name}”.`, 'success');
      setSaveName('');
      setShowSave(false);
    } catch {
      toast?.('Could not save ICP.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetchWithAuth(`/api/leads/icp/profiles/${id}/activate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error('activate failed');
      onProfilesChange(data.profiles as IcpProfileRow[]);
      if (data.settings) onSettingsSaved(data.settings as DirectorySettingsRow);
      toast?.('ICP activated.', 'success');
    } catch {
      toast?.('Could not activate ICP.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetchWithAuth(`/api/leads/icp/profiles/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error('delete failed');
      onProfilesChange(data.profiles as IcpProfileRow[]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast?.('ICP deleted.');
    } catch {
      toast?.('Could not delete ICP.', 'error');
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const discover = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast?.('Tick at least one ICP to discover leads.', 'error');
      return;
    }
    setDiscovering(true);
    try {
      const res = await fetchWithAuth('/api/leads/icp/discover', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ profileIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('discover failed');
      const inserted = (data.inserted as number) ?? 0;
      const count = (data.icpCount as number) ?? ids.length;
      toast?.(
        inserted > 0
          ? `Found ${inserted} new lead${inserted === 1 ? '' : 's'} across ${count} ICP${count === 1 ? '' : 's'}.`
          : `Discovery ran across ${count} ICP${count === 1 ? '' : 's'} - no new leads this time.`,
        'success',
      );
      onDiscoveryComplete?.();
    } catch {
      toast?.('Discovery failed.', 'error');
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div className="space-y-6">
      <IcpChat
        settings={settings}
        onSettingsSaved={onSettingsSaved}
        onProfilesChange={onProfilesChange}
        onDiscoveryComplete={onDiscoveryComplete}
        toast={toast}
      />

      <section className="rounded-lg border border-border bg-bg-secondary">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Saved ICPs</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              The assistant saves what you describe here automatically. Keep an ICP per segment, tick
              the ones to search, then discover leads across them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!showSave ? (
              <button
                type="button"
                onClick={() => {
                  setSaveName('');
                  setShowSave(true);
                }}
                disabled={!canSave}
                title={canSave ? 'Save the current ICP as a named profile' : 'Describe an ICP in the chat first'}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent-primary/40 disabled:opacity-40 min-h-[34px]"
              >
                <Star className="h-3.5 w-3.5" />
                Save current ICP
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-md border border-accent-primary/40 bg-bg-primary px-2 py-1">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveCurrent();
                    if (e.key === 'Escape') setShowSave(false);
                  }}
                  placeholder="Name this ICP…"
                  className="w-40 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void saveCurrent()}
                  disabled={saving || !saveName.trim()}
                  aria-label="Save ICP"
                  className="rounded bg-accent-primary p-1 text-white disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSave(false)}
                  aria-label="Cancel"
                  className="rounded p-1 text-text-tertiary hover:text-text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setFormState({ profile: null });
                setShowSave(false);
              }}
              title="Create an ICP manually - no assistant needed"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent-primary/40 min-h-[34px]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add ICP
            </button>
            <button
              type="button"
              onClick={() => void discover()}
              disabled={discovering || selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-primary/90 disabled:opacity-40 min-h-[34px]"
            >
              {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Discover ({selected.size})
            </button>
          </div>
        </div>

        {formState && (
          <div className="border-b border-border px-4 py-4">
            <IcpForm
              profile={formState.profile}
              onSaved={(profiles) => {
                onProfilesChange(profiles);
                setFormState(null);
              }}
              onCancel={() => setFormState(null)}
              toast={toast}
            />
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="px-4 py-6 text-sm text-text-tertiary">
            No saved ICPs yet. Describe who you sell to in the chat above, then hit{' '}
            <span className="text-text-secondary">Save current ICP</span>.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {profiles.map((p) => {
              const ticked = selected.has(p.id);
              return (
                <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                  <label className="mt-0.5 flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 accent-[color:var(--accent-primary,#6366f1)]"
                      aria-label={`Select ${p.name} for discovery`}
                    />
                  </label>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">{p.name}</span>
                      {p.is_active && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">
                          <Star className="h-2.5 w-2.5" /> Active
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{p.description}</p>
                    )}
                    {(p.verticals.length > 0 || p.keywords.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.verticals.map((v) => (
                          <span
                            key={`v-${v}`}
                            className="inline-flex rounded-full border border-border bg-bg-primary px-2 py-0.5 text-[10px] text-text-secondary"
                          >
                            {v}
                          </span>
                        ))}
                        {p.keywords.slice(0, 8).map((k) => (
                          <span
                            key={`k-${k}`}
                            className="inline-flex rounded-full border border-accent-primary/20 bg-accent-primary/5 px-2 py-0.5 text-[10px] text-accent-primary"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {!p.is_active && (
                      <button
                        type="button"
                        onClick={() => void activate(p.id)}
                        disabled={busyId === p.id}
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent-primary/40 disabled:opacity-40"
                      >
                        {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Use'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setFormState({ profile: p });
                        setShowSave(false);
                      }}
                      aria-label={`Edit ${p.name}`}
                      className="rounded-md p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ id: p.id, name: p.name })}
                      disabled={busyId === p.id}
                      aria-label={`Delete ${p.name}`}
                      className="rounded-md p-1.5 text-text-tertiary hover:text-red-600 hover:bg-bg-tertiary disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete ICP"
        message={
          confirmDelete
            ? `Delete the ICP “${confirmDelete.name}”? This can't be undone.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        loading={confirmDelete !== null && busyId === confirmDelete.id}
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}
