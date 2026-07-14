'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { SignalRuleRow } from '@/lib/signals/types';

const SIGNAL_TYPES: Array<{ value: string; label: string }> = [
  { value: 'accelerator_join', label: 'Accelerator' },
  { value: 'funding_round', label: 'Funding' },
  { value: 'role_change', label: 'Role change' },
  { value: 'launch', label: 'Launch' },
];

const ACTION_MODES: Array<{ value: string; label: string }> = [
  { value: 'notify_only', label: 'Notify only' },
  { value: 'notify_and_draft', label: 'Notify + draft' },
  { value: 'auto_send', label: 'Auto-send' },
];

const CHANNELS: Array<{ value: string; label: string }> = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'linkedin_connect', label: 'LinkedIn invite' },
  { value: 'linkedin_dm', label: 'LinkedIn DM' },
  { value: 'x_dm', label: 'X DM' },
  { value: 'gmail', label: 'Email' },
];

const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  ACTION_MODES.map((m) => [m.value, m.label]),
);

/**
 * Trigger-rule manager: list, create, toggle, and delete workspace rules that
 * decide which signals get drafted/auto-sent. Rules act as an allowlist - with
 * any rule present, only matching signals take action (others just notify).
 */
export function SignalRulesManager() {
  const [rules, setRules] = useState<SignalRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<'any' | 'x' | 'linkedin'>('any');
  const [signalTypes, setSignalTypes] = useState<Set<string>>(new Set());
  const [actionMode, setActionMode] = useState('notify_and_draft');
  const [channel, setChannel] = useState('linkedin_connect');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/signals/rules', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setRules((data.rules ?? []) as SignalRuleRow[]);
      }
    } catch {
      /* non-blocking */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSignalType = (value: string) => {
    setSignalTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name your rule.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/signals/rules', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          platform,
          conditions: signalTypes.size > 0 ? { signal_types: Array.from(signalTypes) } : {},
          action_mode: actionMode,
          channels: [channel],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not create rule');
      }
      const data = await res.json();
      if (data.rule) setRules((prev) => [...prev, data.rule as SignalRuleRow]);
      setName('');
      setSignalTypes(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create rule');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule: SignalRuleRow) => {
    // Optimistic flip; revert on failure.
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    const res = await fetch(`/api/signals/rules/${rule.id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (!res.ok) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      setError('Could not update rule.');
    }
  };

  const handleDelete = async (id: string) => {
    const prev = rules;
    setRules((r) => r.filter((x) => x.id !== id));
    const res = await fetch(`/api/signals/rules/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      setRules(prev);
      setError('Could not delete rule.');
    }
  };

  const describeConditions = (rule: SignalRuleRow): string => {
    const cond = (rule.conditions ?? {}) as { signal_types?: string[] };
    const types = cond.signal_types;
    if (!types || types.length === 0) return 'any signal';
    return types
      .map((t) => SIGNAL_TYPES.find((s) => s.value === t)?.label ?? t)
      .join(', ');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-tertiary leading-relaxed">
        Rules decide what happens automatically. With no rules, signals just notify you. Add a rule
        and only matching signals draft or send; everything else stays a notification.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {loading ? (
        <p className="text-xs text-text-tertiary">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-text-tertiary">No rules yet - signals notify only.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-primary px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{rule.name}</p>
                <p className="text-xs text-text-tertiary">
                  {rule.platform === 'any' ? 'Any platform' : rule.platform?.toUpperCase()} ·{' '}
                  {describeConditions(rule)} · {ACTION_LABEL[rule.action_mode] ?? rule.action_mode}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => handleToggle(rule)}
                  />
                  On
                </label>
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  className="p-1 rounded-md text-text-tertiary hover:text-red-600 hover:bg-bg-secondary"
                  aria-label="Delete rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create form */}
      <div className="rounded-md border border-border bg-bg-primary p-3 space-y-2.5">
        <input
          type="text"
          placeholder="Rule name (e.g. YC founders → auto-draft)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm rounded-md border border-border bg-bg-secondary px-3 py-2 min-h-[40px]"
        />
        <div className="flex flex-wrap gap-1.5">
          {SIGNAL_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => toggleSignalType(t.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                signalTypes.has(t.value)
                  ? 'bg-accent-primary text-white border-accent-primary'
                  : 'bg-bg-secondary text-text-secondary border-border hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'any' | 'x' | 'linkedin')}
            className="text-xs rounded-md border border-border bg-bg-secondary px-2 py-2 min-h-[40px]"
            aria-label="Platform"
          >
            <option value="any">Any platform</option>
            <option value="x">X</option>
            <option value="linkedin">LinkedIn</option>
          </select>
          <select
            value={actionMode}
            onChange={(e) => setActionMode(e.target.value)}
            className="text-xs rounded-md border border-border bg-bg-secondary px-2 py-2 min-h-[40px]"
            aria-label="Action"
          >
            {ACTION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="text-xs rounded-md border border-border bg-bg-secondary px-2 py-2 min-h-[40px]"
            aria-label="Channel"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-md bg-accent-primary text-white disabled:opacity-50 min-h-[40px]"
          >
            <Plus className="h-4 w-4" />
            {saving ? 'Adding…' : 'Add rule'}
          </button>
        </div>
        <p className="text-[11px] text-text-tertiary">
          Auto-send only fires for tracked person profiles and respects your safety limits.
        </p>
      </div>
    </div>
  );
}
