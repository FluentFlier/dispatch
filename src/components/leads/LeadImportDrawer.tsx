'use client';

import { useCallback, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { Upload, FileSpreadsheet, X, Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import {
  downloadLeadImportSample,
  LEAD_IMPORT_COLUMN_ALIASES,
  LEAD_IMPORT_EXPORT_GUIDES,
} from '@/lib/signals/leads/import-guide';

interface LeadImportDrawerProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  toast: (message: string, type?: 'success' | 'error') => void;
}

/**
 * Upload CSV / XLSX / PDF / JSON lead lists. Parses contacts + LinkedIn URLs,
 * upserts as manual leads, and resolves LinkedIn profiles for outreach.
 */
export function LeadImportDrawer({ open, onClose, onComplete, toast }: LeadImportDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const pickFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
  };

  const importFile = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('resolve', 'true');
      const res = await fetchWithAuth('/api/leads/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');

      const r = data.result as {
        parsed: number;
        inserted: number;
        updated: number;
        resolved: number;
        noContact: number;
        warnings?: string[];
      };

      const parts = [
        `${r.inserted} new`,
        r.updated ? `${r.updated} updated` : null,
        `${r.resolved} LinkedIn-ready`,
      ].filter(Boolean);

      toast(`Imported ${r.parsed} leads (${parts.join(', ')}).`, 'success');
      if (r.warnings?.length) {
        toast(r.warnings.join(' '), 'error');
      }
      reset();
      onComplete();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <h2 className="text-title mb-4">Import leads</h2>
      <p className="text-sm text-text-secondary mb-4">
        Drop a CSV, Excel, PDF, or JSON export from Apollo, Clay, HubSpot, or a spreadsheet.
        We map company + contact + LinkedIn and add them to your feed for outreach.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => downloadLeadImportSample()}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download sample CSV
        </Button>
        <span className="text-xs text-text-tertiary">Use as a template or sanity-check your export.</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-accent-primary bg-accent-light/30' : 'border-border bg-bg-secondary/50'
        }`}
      >
        <Upload className="h-8 w-8 mx-auto text-text-tertiary mb-2" />
        <p className="text-sm font-medium text-text-primary">Drop file here or click to browse</p>
        <p className="text-xs text-text-tertiary mt-1">CSV · XLSX · PDF · JSON · TXT (max 5MB, up to 200 rows)</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.pdf"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <span className="flex items-center gap-2 min-w-0 truncate">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent-primary" />
            {file.name}
          </span>
          <button type="button" onClick={reset} aria-label="Remove file" className="text-text-tertiary hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-5 space-y-2">
        <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Export from</p>
        {LEAD_IMPORT_EXPORT_GUIDES.map((guide) => (
          <details key={guide.id} className="group rounded-md border border-border bg-bg-secondary/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-text-primary [&::-webkit-details-marker]:hidden">
              {guide.title}
              <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
            </summary>
            <ol className="list-decimal space-y-1.5 border-t border-border px-3 py-2.5 pl-7 text-xs text-text-secondary">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>

      <p className="text-xs text-text-tertiary mt-4">
        Recognized columns: {LEAD_IMPORT_COLUMN_ALIASES.join('; ')}. PDFs are parsed with AI when headers
        are missing.
      </p>

      <div className="flex gap-2 mt-6">
        <Button variant="primary" size="sm" onClick={() => void importFile()} loading={busy} disabled={!file}>
          Import & resolve LinkedIn
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Drawer>
  );
}
