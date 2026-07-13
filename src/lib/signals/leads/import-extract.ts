import { chatCompletion, isLlmConfigured } from '@/lib/llm';
import {
  mapExtractedImportLeads,
  type ExtractedImportLead,
} from '@/lib/signals/leads/import-map';
import type { IngestedLead } from '@/lib/signals/types';

const EXTRACT_SYSTEM = [
  'You extract sales leads from unstructured text (PDF export, notes, pasted list).',
  'Return ONLY valid JSON:',
  '{"leads":[{"company_name":"...","contact_name":"...","contact_role":"...","linkedin_url":"...","email":"...","website":"...","tagline":"..."}]}',
  'Include only rows with at least a company OR a LinkedIn profile URL OR an email.',
  'Use real linkedin.com/in/ URLs when present in the text. Do not invent companies.',
  'Max 100 leads.',
].join(' ');

export function parseExtractedImportJson(raw: string): ExtractedImportLead[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    const parsed = JSON.parse(candidate) as { leads?: unknown };
    return Array.isArray(parsed.leads) ? (parsed.leads as ExtractedImportLead[]) : [];
  } catch {
    const match = raw.match(/\{[\s\S]*"leads"[\s\S]*\}/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]) as { leads?: unknown };
      return Array.isArray(parsed.leads) ? (parsed.leads as ExtractedImportLead[]) : [];
    } catch {
      return [];
    }
  }
}

/** LLM extraction for PDF/plain-text lists without column headers. */
export async function extractLeadsFromText(rawText: string): Promise<IngestedLead[]> {
  const text = rawText.trim().slice(0, 24_000);
  if (!text) return [];
  if (!isLlmConfigured()) return [];

  const userMsg = [
    'Extract every lead you can from this document. Prefer founder LinkedIn URLs.',
    '',
    text,
  ].join('\n');

  const raw = await chatCompletion(EXTRACT_SYSTEM, userMsg, {
    temperature: 0.1,
    maxTokens: 4000,
  });

  return mapExtractedImportLeads(parseExtractedImportJson(raw));
}
