/**
 * Parses CSV/TSV text into row objects keyed by header names (lowercased).
 */
export function parseDelimitedText(text: string, delimiter = ','): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/^\uFEFF/, ''));
  const rows: Record<string, string>[] = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? '').trim();
    });
    if (Object.values(row).some(Boolean)) rows.push(row);
  }

  return rows;
}

export type ImportFileKind = 'csv' | 'tsv' | 'xlsx' | 'json' | 'pdf' | 'text' | 'unknown';

const EXT_KIND: Record<string, ImportFileKind> = {
  csv: 'csv',
  tsv: 'tsv',
  txt: 'text',
  xlsx: 'xlsx',
  xls: 'xlsx',
  json: 'json',
  pdf: 'pdf',
};

export function detectImportFileKind(filename: string, mimeType?: string): ImportFileKind {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return 'xlsx';
  if (mimeType === 'text/csv') return 'csv';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/json') return 'json';
  return 'unknown';
}

export interface ParsedImportFile {
  kind: ImportFileKind;
  rows: Record<string, string>[];
  rawText: string;
}

export async function parseImportFileBuffer(
  buffer: Buffer,
  filename: string,
  mimeType?: string,
): Promise<ParsedImportFile> {
  const kind = detectImportFileKind(filename, mimeType);

  if (kind === 'json') {
    const rawText = buffer.toString('utf8');
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const arr = Array.isArray(parsed) ? parsed : (parsed as { leads?: unknown }).leads;
      if (!Array.isArray(arr)) return { kind, rows: [], rawText };
      const rows = arr.map((item) => flattenRecord(item));
      return { kind, rows, rawText };
    } catch {
      return { kind, rows: [], rawText };
    }
  }

  if (kind === 'xlsx') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { kind, rows: [], rawText: '' };
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const rows = json.map((item) => flattenRecord(item));
    return { kind, rows, rawText: rows.map((r) => JSON.stringify(r)).join('\n') };
  }

  if (kind === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const rawText = result.text?.trim() ?? '';
      return { kind, rows: [], rawText };
    } finally {
      await parser.destroy();
    }
  }

  const rawText = buffer.toString('utf8');
  if (kind === 'csv') {
    return { kind, rows: parseDelimitedText(rawText, ','), rawText };
  }
  if (kind === 'tsv') {
    return { kind, rows: parseDelimitedText(rawText, '\t'), rawText };
  }
  if (kind === 'text' || kind === 'unknown') {
    if (rawText.includes('\t') && rawText.includes('\n')) {
      return { kind: 'tsv', rows: parseDelimitedText(rawText, '\t'), rawText };
    }
    if (rawText.includes(',') && rawText.includes('\n')) {
      return { kind: 'csv', rows: parseDelimitedText(rawText, ','), rawText };
    }
    return { kind: kind === 'unknown' ? 'text' : kind, rows: [], rawText };
  }

  return { kind, rows: [], rawText: '' };
}

function flattenRecord(item: unknown): Record<string, string> {
  if (!item || typeof item !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    const k = key.toLowerCase().trim();
    if (value === null || value === undefined) continue;
    out[k] = String(value).trim();
  }
  return out;
}
