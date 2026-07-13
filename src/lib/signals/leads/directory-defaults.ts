import type { LeadSource } from '@/lib/signals/types';
import { isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-fetch';
import {
  isWebDiscoveryConfigured,
  isSerperWebDiscoveryConfigured,
} from '@/lib/signals/ingest/lead-sources/web-discovery-config';

/** ICP-driven open-web discovery — primary source for any vertical. */
export const PRIMARY_DISCOVERY_SOURCES: LeadSource[] = ['web_discovery'];

/** Optional fixed startup directories (YC, Product Hunt). */
export const OPTIONAL_DIRECTORY_SOURCES: LeadSource[] = [
  'yc_directory',
  'yc_launches',
  'product_hunt',
];

/** Social platform adapters (LinkedIn, X) — register in lead-sources/social-stubs. */
export const SOCIAL_DISCOVERY_SOURCES: LeadSource[] = ['linkedin', 'x'];

export const ALL_CONFIGURABLE_SOURCES: LeadSource[] = [
  ...PRIMARY_DISCOVERY_SOURCES,
  ...OPTIONAL_DIRECTORY_SOURCES,
  ...SOCIAL_DISCOVERY_SOURCES,
];

/**
 * Default enabled_sources for a new workspace.
 * Web discovery when LLM + (Serper or TinyFish); YC Algolia always on.
 */
export function defaultEnabledSources(): LeadSource[] {
  const sources: LeadSource[] = ['yc_directory'];
  if (isWebDiscoveryConfigured()) sources.unshift('web_discovery');
  if (isTinyFishConfigured()) {
    for (const s of OPTIONAL_DIRECTORY_SOURCES) {
      if (s !== 'yc_directory' && !sources.includes(s)) sources.push(s);
    }
  }
  return sources;
}

/** Ensures configured discovery sources are enabled for the workspace. */
export function mergeEnabledSources(current: LeadSource[]): LeadSource[] {
  const merged = new Set<LeadSource>(current.length > 0 ? current : defaultEnabledSources());
  if (isWebDiscoveryConfigured()) merged.add('web_discovery');
  if (!merged.has('yc_directory')) merged.add('yc_directory');
  return Array.from(merged);
}

/** UI metadata for the GTM setup source toggles. */
export const LEAD_SOURCE_UI: Array<{
  key: LeadSource;
  label: string;
  hint?: string;
  disabled?: () => boolean;
}> = [
  {
    key: 'web_discovery',
    label: 'Web discovery (ICP search)',
    hint: isSerperWebDiscoveryConfigured()
      ? 'Google + your ICP — any vertical'
      : 'TinyFish + your ICP — any vertical',
    disabled: () => !isWebDiscoveryConfigured(),
  },
  { key: 'yc_directory', label: 'YC directory' },
  { key: 'yc_launches', label: 'YC launches', disabled: () => !isTinyFishConfigured() },
  { key: 'product_hunt', label: 'Product Hunt', disabled: () => !isTinyFishConfigured() },
  {
    key: 'linkedin',
    label: 'LinkedIn discovery',
    hint: 'Coming soon',
    disabled: () => true,
  },
  {
    key: 'x',
    label: 'X discovery',
    hint: 'In progress',
    disabled: () => true,
  },
];
