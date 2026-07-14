import type { LeadSource } from '@/lib/signals/types';
// Env-only checks from the client-safe module (tinyfish-fetch pulls in @/lib/llm →
// next/headers, which must never enter a client bundle - this file is imported by
// the leads source-toggle UI).
import { isTinyfishConfigured as isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-web';
import {
  isWebDiscoveryConfigured,
  isSerperWebDiscoveryConfigured,
  isLlmConfiguredForDiscovery,
} from '@/lib/signals/ingest/lead-sources/web-discovery-config';

/** ICP-driven open-web discovery - primary source for any vertical. */
export const PRIMARY_DISCOVERY_SOURCES: LeadSource[] = ['web_discovery'];

/** Fixed startup directories (YC Algolia + YC Launches / Product Hunt via TinyFish). */
export const OPTIONAL_DIRECTORY_SOURCES: LeadSource[] = ['yc_directory', 'yc_launches', 'product_hunt'];

/** Social platform adapters (LinkedIn via Apify, X via TinyFish) - see lead-sources/social-discovery. */
export const SOCIAL_DISCOVERY_SOURCES: LeadSource[] = ['linkedin', 'x'];

export const ALL_CONFIGURABLE_SOURCES: LeadSource[] = [
  ...PRIMARY_DISCOVERY_SOURCES,
  ...OPTIONAL_DIRECTORY_SOURCES,
  ...SOCIAL_DISCOVERY_SOURCES,
];

// Availability MUST mirror each adapter's own isAvailable() (social-discovery.ts):
// X = TinyFish Search + LLM; LinkedIn = Apify token. Env-only so this stays
// client-safe. (Non-NEXT_PUBLIC vars read undefined in the browser bundle, so the
// UI toggle may show these disabled; the server-side default/merge below is what
// actually enables them for a scrape.)
const isXDiscoveryAvailable = (): boolean => isTinyFishConfigured() && isLlmConfiguredForDiscovery();
const isLinkedinDiscoveryAvailable = (): boolean => Boolean(process.env.APIFY_TOKEN?.trim());

/**
 * Default enabled_sources for a new workspace. YC Algolia always on; the rest are
 * added only when their scraper is configured, so a workspace never enables a
 * source with no scraper behind it.
 */
export function defaultEnabledSources(): LeadSource[] {
  const sources: LeadSource[] = ['yc_directory'];
  if (isWebDiscoveryConfigured()) sources.unshift('web_discovery');
  if (isTinyFishConfigured()) {
    for (const s of OPTIONAL_DIRECTORY_SOURCES) {
      if (s !== 'yc_directory' && !sources.includes(s)) sources.push(s);
    }
  }
  if (isLinkedinDiscoveryAvailable()) sources.push('linkedin');
  if (isXDiscoveryAvailable()) sources.push('x');
  return sources;
}

/** Ensures every configured discovery source is enabled for the workspace. */
export function mergeEnabledSources(current: LeadSource[]): LeadSource[] {
  const merged = new Set<LeadSource>(current.length > 0 ? current : defaultEnabledSources());
  if (isWebDiscoveryConfigured()) merged.add('web_discovery');
  if (isTinyFishConfigured()) {
    merged.add('yc_launches');
    merged.add('product_hunt');
  }
  if (isLinkedinDiscoveryAvailable()) merged.add('linkedin');
  if (isXDiscoveryAvailable()) merged.add('x');
  merged.add('yc_directory');
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
    // TinyFish Search+Fetch is the primary scraper; Serper is the fallback.
    hint: isSerperWebDiscoveryConfigured()
      ? 'TinyFish + Serper fallback + your ICP - any vertical'
      : 'TinyFish + your ICP - any vertical',
    disabled: () => !isWebDiscoveryConfigured(),
  },
  { key: 'yc_directory', label: 'YC directory' },
  { key: 'yc_launches', label: 'YC launches', disabled: () => !isTinyFishConfigured() },
  { key: 'product_hunt', label: 'Product Hunt', disabled: () => !isTinyFishConfigured() },
  {
    key: 'linkedin',
    label: 'LinkedIn discovery',
    hint: 'Apify LinkedIn company search + your ICP',
    disabled: () => !isLinkedinDiscoveryAvailable(),
  },
  {
    key: 'x',
    label: 'X discovery',
    hint: 'TinyFish X search + your ICP',
    disabled: () => !isXDiscoveryAvailable(),
  },
];
