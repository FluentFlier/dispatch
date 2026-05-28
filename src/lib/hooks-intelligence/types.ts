/**
 * Hook Intelligence System for Dispatch
 * 
 * Powers phenomenal hook generation and social listening.
 * Data mined for free via gstack browser automation.
 * Includes a lightweight learned ranker (RL-style scoring) for "best" hooks per context.
 */

export type HookVertical =
  | 'indie_maker'
  | 'direct_response'
  | 'thread_systems'
  | 'one_person_business'
  | 'visual_design'
  | 'audience_building'
  | 'mindset'
  | 'copywriting'
  | 'ai'
  | 'tech'
  | 'general';

export interface ExtractedHook {
  id: string;                    // hash of text + author
  text: string;
  author: string;
  platform: 'x' | 'linkedin' | 'other';
  url?: string;
  verticals: HookVertical[];
  engagement?: {
    likes?: number;
    replies?: number;
    reposts?: number;
    views?: number;
  };
  minedAt: string;               // ISO
  pattern?: string;              // detected pattern type
}

export interface HookScore {
  hookId: string;
  specificity: number;           // 0-10 - concrete numbers, names, details
  resultsLanguage: number;       // 0-10 - "I made $X", outcomes
  emotionalTrigger: number;      // 0-10 - curiosity, contrarian, story, pain
  ctaStrength: number;           // 0-10 - clear ask or implication
  lengthScore: number;           // 0-10 - optimal for platform
  verticalFit: number;           // 0-10
  engagementProxy: number;       // from scraped data if available
  total: number;                 // composite 0-100
  confidence: number;            // how reliable the score is
}

export interface RankedHook extends ExtractedHook {
  score: HookScore;
}

export interface HookDataset {
  version: string;
  lastUpdated: string;
  hooks: ExtractedHook[];
  scores: Record<string, HookScore>;  // hookId -> score
}

export interface SocialWatchConfig {
  accounts: Array<{
    handle: string;
    verticals: HookVertical[];
    priority: number;            // 1-10, how often to listen
  }>;
  keywords: string[];            // trending topics to monitor
  refreshIntervalHours: number;
}
