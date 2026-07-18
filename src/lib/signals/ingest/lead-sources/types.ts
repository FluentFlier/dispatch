import type { IngestedLead, LeadSource } from '@/lib/signals/types';

/** Shared inputs for every lead discovery adapter in the registry. */
export interface DiscoveryContext {
  icpDescription: string | null;
  icpVerticals: string[];
  icpKeywords: string[];
  /** Space-joined verticals + keywords (+ description fallback). */
  icpQuery: string;
  /**
   * Parsed natural-language hunt goal (stage, vertical, geography, signals).
   * Preferred by web discovery when present, so constraints like "in NYC"
   * survive instead of being flattened into keywords.
   */
  discoveryGoal?: string | null;
  maxLeads: number;
}

export interface LeadDiscoveryAdapter {
  source: LeadSource;
  /** Short label for logs and UI. */
  label: string;
  /** icp = ICP-driven open web; directory = fixed listing sites; social = platform-native. */
  category: 'icp' | 'directory' | 'social';
  /** When false the adapter is skipped (missing API keys, not yet implemented, etc.). */
  isAvailable: () => boolean;
  /** Returns normalized leads; throws only on hard failures the registry should catch. */
  discover: (ctx: DiscoveryContext) => Promise<IngestedLead[]>;
}

export interface PerSourceResult {
  source: LeadSource;
  count: number;
  error?: string;
}

export interface RunLeadDiscoveryInput extends DiscoveryContext {
  enabledSources: LeadSource[];
  onAdapterStart?: (source: LeadSource, index: number, total: number) => void;
}

export interface RunLeadDiscoveryResult {
  leads: IngestedLead[];
  perSource: PerSourceResult[];
  warnings: string[];
}
