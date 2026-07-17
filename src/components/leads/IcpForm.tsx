'use client';

import { useState, type KeyboardEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import type { IcpProfileRow } from '@/lib/signals/types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/** Tag/chip input: type + Enter or comma to add, click × to remove. */
function ChipInput({
  values,
  onChange,
  placeholder,
  ariaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, '').trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-primary px-2 py-1.5 focus-within:ring-2 focus-within:ring-accent-primary/30">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-full border border-accent-primary/20 bg-accent-primary/5 px-2 py-0.5 text-[11px] text-accent-primary"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
            className="text-accent-primary/70 hover:text-accent-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={values.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
      />
    </div>
  );
}

interface IcpFormProps {
  /** Profile to edit; omit for create. */
  profile?: IcpProfileRow | null;
  onSaved: (profiles: IcpProfileRow[]) => void;
  onCancel: () => void;
  toast?: (message: string, type?: 'success' | 'error') => void;
}

/**
 * Manual ICP editor - create a new ICP or edit an existing one WITHOUT the
 * assistant. Name + description + verticals/keywords chips. Persists via the
 * same profiles API the assistant path uses (POST to create, PATCH to edit).
 */
export function IcpForm({ profile, onSaved, onCancel, toast }: IcpFormProps) {
  const editing = Boolean(profile);
  const [name, setName] = useState(profile?.name ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [verticals, setVerticals] = useState<string[]>(profile?.verticals ?? []);
  const [keywords, setKeywords] = useState<string[]>(profile?.keywords ?? []);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast?.('Give your ICP a name.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/leads/icp/profiles/${profile!.id}` : '/api/leads/icp/profiles';
      const res = await fetchWithAuth(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
          verticals,
          keywords,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.profiles) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Save failed');
      }
      onSaved(data.profiles as IcpProfileRow[]);
      toast?.(editing ? 'ICP updated.' : `Saved "${trimmedName}".`, 'success');
    } catch (err) {
      toast?.(err instanceof Error ? err.message : 'Could not save ICP.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-accent-primary/30 bg-bg-primary p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">{editing ? 'Edit ICP' : 'Add ICP'}</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="rounded p-1 text-text-tertiary hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="block text-xs font-medium text-text-secondary">
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Seed fintech founders"
          className="mt-1 block w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        />
      </label>

      <label className="block text-xs font-medium text-text-secondary">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Who do you sell to? Stage, industry, geography, signals like funding or YC batch."
          className="mt-1 block w-full resize-none rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        />
      </label>

      <div>
        <span className="block text-xs font-medium text-text-secondary">Verticals</span>
        <ChipInput values={verticals} onChange={setVerticals} placeholder="Add a vertical…" ariaLabel="Verticals" />
      </div>

      <div>
        <span className="block text-xs font-medium text-text-secondary">Keywords</span>
        <ChipInput values={keywords} onChange={setKeywords} placeholder="Add a keyword…" ariaLabel="Keywords" />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>
          {editing ? 'Save changes' : 'Add ICP'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />}
      </div>
    </div>
  );
}
