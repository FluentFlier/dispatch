'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileText, Link2, Loader2, Sparkles, Trash2, Type, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePillars } from '@/hooks/usePillars';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { getInsforge } from '@/lib/insforge/client';

type Step = 'setup' | 'sources' | 'arc' | 'review' | 'done';
type Platform = 'linkedin' | 'twitter' | 'instagram' | 'threads';

const WEEKDAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

interface SourceRow {
  id: string;
  kind: string;
  title: string | null;
  status: string;
  char_count: number;
  error?: string | null;
}

interface PartRow {
  id: string;
  series_position: number;
  title: string;
  hook: string | null;
  script: string | null;
  series_approved: boolean;
  status: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function SeriesWizard() {
  const router = useRouter();
  const { pillars } = usePillars();

  const [step, setStep] = useState<Step>('setup');
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Setup fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState<Platform>('linkedin');
  const [pillar, setPillar] = useState('explainer');
  const [numParts, setNumParts] = useState(5);
  const [days, setDays] = useState<string[]>(['tue', 'thu']);
  const [time, setTime] = useState('09:00');
  const [startDate, setStartDate] = useState(todayISO());
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [autoPublish, setAutoPublish] = useState(true);
  const [creating, setCreating] = useState(false);

  // Sources
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [addingSource, setAddingSource] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [urlInput, setUrlInput] = useState('');

  // Arc + review
  const [parts, setParts] = useState<PartRow[]>([]);
  const [planning, setPlanning] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [genLoading, setGenLoading] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [approving, setApproving] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [schedulePreview, setSchedulePreview] = useState<Array<{ position: number; at: string; queued: boolean }>>([]);

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  // --- Step 1: create the series shell ---
  const createSeries = async () => {
    if (!name.trim()) { setError('Give the series a name'); return; }
    if (days.length === 0) { setError('Pick at least one posting day'); return; }
    setCreating(true); setError('');
    try {
      const res = await fetchWithAuth('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          platform, pillar,
          total_parts: numParts,
          auto_publish: autoPublish,
          cadence: { days, time, start_date: startDate, interval_weeks: intervalWeeks, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create series');
      const { series } = await res.json();
      setSeriesId(series.id);
      setStep('sources');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create series');
    } finally {
      setCreating(false);
    }
  };

  // --- Step 2: sources ---
  const refreshSources = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/series/${id}/sources`);
    if (res.ok) setSources((await res.json()).sources ?? []);
  }, []);

  const addSource = async (payload: Record<string, unknown>) => {
    if (!seriesId) return;
    setAddingSource(true); setError('');
    try {
      const res = await fetchWithAuth(`/api/series/${seriesId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not add source');
      await refreshSources(seriesId);
      setPasteText(''); setUrlInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add source');
    } finally {
      setAddingSource(false);
    }
  };

  const onFile = async (file: File) => {
    setAddingSource(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const parseRes = await fetchWithAuth('/api/generate/parse-file', { method: 'POST', body: fd });
      if (!parseRes.ok) throw new Error((await parseRes.json().catch(() => ({}))).error || 'Could not read file');
      const { name: fname, text } = await parseRes.json();
      if (!text?.trim()) throw new Error('No text found in file');
      await addSource({ kind: 'file', title: fname, text });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add file');
      setAddingSource(false);
    }
  };

  const deleteSource = async (sid: string) => {
    if (!seriesId) return;
    await fetchWithAuth(`/api/series/${seriesId}/sources/${sid}`, { method: 'DELETE' });
    await refreshSources(seriesId);
  };

  // --- Step 3: plan the arc ---
  const loadParts = useCallback(async (id: string) => {
    const insforge = getInsforge();
    const { data: userData } = await insforge.auth.getCurrentUser();
    const uid = userData?.user?.id;
    if (!uid) return;
    const { data } = await insforge.database
      .from('posts').select('id, series_position, title, hook, script, series_approved, status')
      .eq('series_id', id).eq('user_id', uid)
      .order('series_position', { ascending: true });
    setParts((data ?? []) as PartRow[]);
  }, []);

  const planArc = async () => {
    if (!seriesId) return;
    setPlanning(true); setError('');
    try {
      const res = await fetchWithAuth(`/api/series/${seriesId}/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numParts }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not plan series');
      await loadParts(seriesId);
      setReviewIndex(0); setDraftText('');
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not plan series');
    } finally {
      setPlanning(false);
    }
  };

  // --- Step 4: per-part review ---
  const current = parts[reviewIndex];

  const generatePart = async () => {
    if (!seriesId || !current) return;
    setGenLoading(true); setError('');
    try {
      const res = await fetchWithAuth(`/api/series/${seriesId}/parts/${current.series_position}/generate`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Generation failed');
      const { text } = await res.json();
      setDraftText(text);
      setParts((prev) => prev.map((p, i) => (i === reviewIndex ? { ...p, script: text, status: 'scripted', series_approved: false } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenLoading(false);
    }
  };

  const approvePart = async () => {
    if (!current) return;
    setApproving(true); setError('');
    try {
      const res = await fetchWithAuth(`/api/posts/${current.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: draftText, series_approved: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not approve');
      setParts((prev) => prev.map((p, i) => (i === reviewIndex ? { ...p, script: draftText, series_approved: true } : p)));
      if (reviewIndex < parts.length - 1) {
        setReviewIndex(reviewIndex + 1);
        setDraftText(parts[reviewIndex + 1]?.script ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setApproving(false);
    }
  };

  const allApproved = parts.length > 0 && parts.every((p) => p.series_approved && p.script?.trim());

  // --- Step 5: confirm all + schedule ---
  const confirmAll = async () => {
    if (!seriesId) return;
    setScheduling(true); setError('');
    try {
      const res = await fetchWithAuth(`/api/series/${seriesId}/schedule`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not schedule');
      const data = await res.json();
      setSchedulePreview(data.scheduled ?? []);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not schedule');
    } finally {
      setScheduling(false);
    }
  };

  const approvedCount = parts.filter((p) => p.series_approved && p.script?.trim()).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader eyebrow="SERIES" title="Plan a Series" />

      <StepBar step={step} />

      {error && <p className="text-[13px] text-accent-primary">{error}</p>}

      {/* STEP 1: SETUP */}
      {step === 'setup' && (
        <div className="space-y-5 bg-bg-secondary border border-border rounded-lg p-5">
          <Field label="Series name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Legends of Motorsport"
              className="input" />
          </Field>
          <Field label="What is this series about?">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="The premise, the arc, the payoff." className="input resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Platform">
              <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className="input">
                <option value="linkedin">LinkedIn</option>
                <option value="twitter">X / Twitter</option>
                <option value="instagram">Instagram</option>
                <option value="threads">Threads</option>
              </select>
            </Field>
            <Field label="Pillar">
              <select value={pillar} onChange={(e) => setPillar(e.target.value)} className="input">
                {pillars.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Number of parts">
            <input type="number" min={2} max={20} value={numParts}
              onChange={(e) => setNumParts(Math.min(20, Math.max(2, parseInt(e.target.value, 10) || 2)))}
              className="input w-28" />
          </Field>

          <div className="border-t border-hair pt-4 space-y-4">
            <p className="section-label">Cadence</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button key={d.key} onClick={() => toggleDay(d.key)}
                  className={`px-3 py-1.5 rounded-md text-[12px] border transition-colors ${
                    days.includes(d.key) ? 'bg-accent-primary text-white border-accent-primary' : 'border-border text-text-secondary hover:border-border-hover'
                  }`}>{d.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" /></Field>
              <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" /></Field>
              <Field label="Every N weeks">
                <input type="number" min={1} max={8} value={intervalWeeks}
                  onChange={(e) => setIntervalWeeks(Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 1)))} className="input" />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} className="w-4 h-4 accent-accent-primary" />
              <span className="text-[13px] text-text-primary">Auto-publish each part on schedule once I approve the whole series</span>
            </label>
          </div>

          <Button onClick={createSeries} loading={creating} disabled={!name.trim()}>Continue to sources</Button>
        </div>
      )}

      {/* STEP 2: SOURCES */}
      {step === 'sources' && (
        <div className="space-y-5">
          <div className="bg-bg-secondary border border-border rounded-lg p-5 space-y-4">
            <p className="text-[13px] text-text-secondary">
              Drop reference material. Every part is grounded in these sources plus your voice.
            </p>

            <div className="space-y-3">
              <div>
                <label className="section-label flex items-center gap-1.5 mb-2"><Type size={13} /> Paste notes / transcript</label>
                <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={3}
                  placeholder="Paste any text..." className="input resize-none" />
                <div className="mt-2">
                  <Button variant="secondary" size="sm" disabled={!pasteText.trim() || addingSource}
                    onClick={() => addSource({ kind: 'text', text: pasteText })}>Add text</Button>
                </div>
              </div>

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="section-label flex items-center gap-1.5 mb-2"><Link2 size={13} /> Reference URL</label>
                  <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://..." className="input" />
                </div>
                <Button variant="secondary" size="sm" disabled={!urlInput.trim() || addingSource}
                  onClick={() => addSource({ kind: 'url', url: urlInput.trim() })}>Fetch</Button>
              </div>

              <div>
                <label className="section-label flex items-center gap-1.5 mb-2"><Upload size={13} /> Upload file (.txt, .md, .pdf)</label>
                <input type="file" accept=".txt,.md,.pdf" disabled={addingSource}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
                  className="text-[12px] text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-bg-tertiary file:text-text-primary file:cursor-pointer" />
              </div>
            </div>

            {addingSource && <p className="text-[12px] text-text-secondary flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Indexing source...</p>}
          </div>

          {sources.length > 0 && (
            <div className="bg-bg-secondary border border-border rounded-lg p-4 space-y-2">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-bg-tertiary">
                  <FileText size={14} className="text-text-secondary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-text-primary truncate">{s.title || s.kind}</p>
                    <p className="text-[11px] text-text-secondary">
                      {s.status === 'ready' ? `${s.char_count.toLocaleString()} chars indexed` : s.status === 'failed' ? (s.error || 'Failed') : 'Pending'}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${s.status === 'ready' ? 'text-green-600' : s.status === 'failed' ? 'text-accent-primary' : 'text-text-secondary'}`}>{s.status}</span>
                  <button onClick={() => deleteSource(s.id)} className="text-text-secondary hover:text-accent-primary"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={() => setStep('arc')}>{sources.length ? 'Continue to arc' : 'Skip - no sources'}</Button>
          </div>
        </div>
      )}

      {/* STEP 3: ARC */}
      {step === 'arc' && (
        <div className="space-y-5 bg-bg-secondary border border-border rounded-lg p-5">
          <p className="text-[13px] text-text-secondary">
            Generate the {numParts}-part arc, grounded in your sources and voice. You will review each part next.
          </p>
          <Button onClick={planArc} loading={planning}>
            <Sparkles size={15} className="mr-1.5" /> Generate arc
          </Button>
        </div>
      )}

      {/* STEP 4: REVIEW */}
      {step === 'review' && current && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-text-secondary">Part {current.series_position} of {parts.length}</p>
            <p className="text-[12px] text-text-secondary">{approvedCount}/{parts.length} approved</p>
          </div>

          <div className="bg-bg-secondary border border-border rounded-lg p-5 space-y-4">
            <div>
              <h3 className="text-[17px] text-ink mb-1">{current.title}</h3>
              {current.hook && <p className="text-[13px] text-text-tertiary italic">{current.hook}</p>}
            </div>

            {!draftText && !current.script ? (
              <Button onClick={generatePart} loading={genLoading}><Sparkles size={15} className="mr-1.5" /> Generate this part</Button>
            ) : (
              <>
                <textarea value={draftText || current.script || ''} onChange={(e) => setDraftText(e.target.value)} rows={12}
                  className="input resize-y font-body leading-relaxed" />
                <div className="flex gap-2">
                  <Button onClick={approvePart} loading={approving} disabled={!(draftText || current.script)?.trim()}>
                    <Check size={15} className="mr-1.5" /> {current.series_approved ? 'Re-approve' : 'Approve'} & next
                  </Button>
                  <Button variant="secondary" onClick={generatePart} loading={genLoading}>Regenerate</Button>
                </div>
              </>
            )}
          </div>

          {/* Part rail */}
          <div className="flex flex-wrap gap-1.5">
            {parts.map((p, i) => (
              <button key={p.id} onClick={() => { setReviewIndex(i); setDraftText(p.script ?? ''); }}
                className={`w-8 h-8 rounded-md text-[12px] flex items-center justify-center border transition-colors ${
                  i === reviewIndex ? 'border-accent-primary text-accent-primary' :
                  p.series_approved ? 'bg-green-600/10 border-green-600/30 text-green-600' : 'border-border text-text-secondary'
                }`} title={p.title}>
                {p.series_approved ? <Check size={13} /> : p.series_position}
              </button>
            ))}
          </div>

          {allApproved && (
            <div className="bg-bg-secondary border border-accent-primary/40 rounded-lg p-5 space-y-3">
              <p className="text-[13px] text-text-primary">All parts approved. {autoPublish ? 'Confirm to schedule and arm auto-publish.' : 'Confirm to schedule.'}</p>
              <Button onClick={confirmAll} loading={scheduling}>Confirm all &amp; schedule</Button>
            </div>
          )}
        </div>
      )}

      {/* STEP 5: DONE */}
      {step === 'done' && (
        <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4 text-center">
          <div className="inline-flex w-12 h-12 rounded-full bg-green-600/10 items-center justify-center mx-auto">
            <Check className="text-green-600" size={24} />
          </div>
          <h2 className="text-[20px] text-ink">Series scheduled</h2>
          <p className="text-[13px] text-text-secondary">
            {schedulePreview.length} parts mapped out{autoPublish ? ' and armed to auto-publish' : ''}. Pause anytime from the series list.
          </p>
          <div className="text-left max-w-md mx-auto space-y-1">
            {schedulePreview.map((s) => (
              <div key={s.position} className="flex justify-between text-[12px] px-3 py-1.5 rounded bg-bg-tertiary">
                <span className="text-text-secondary">Part {s.position}</span>
                <span className="text-text-primary">{new Date(s.at).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => router.push('/series')}>Back to series</Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="section-label block mb-2">{label}</label>
      {children}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const order: Step[] = ['setup', 'sources', 'arc', 'review', 'done'];
  const labels: Record<Step, string> = { setup: 'Setup', sources: 'Sources', arc: 'Arc', review: 'Review', done: 'Done' };
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {order.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span className={i <= idx ? 'text-accent-primary font-medium' : 'text-text-secondary'}>{labels[s]}</span>
          {i < order.length - 1 && <span className="text-border">/</span>}
        </div>
      ))}
    </div>
  );
}
