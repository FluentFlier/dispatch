/**
 * Curated high-signal watchlist for Hook Intelligence + Social Listening
 * 
 * These accounts consistently produce high-conversion, high-engagement content
 * across the creator / indie / copy / business palette.
 * 
 * Mined for free using gstack. Expand this list aggressively.
 */

import type { HookVertical, SocialWatchConfig } from './types';

export const DEFAULT_WATCHLIST: SocialWatchConfig = {
  accounts: [
    // Indie Maker / Revenue Transparency
    { handle: 'levelsio', verticals: ['indie_maker'], priority: 10 },
    { handle: 'thedankoe', verticals: ['one_person_business', 'mindset'], priority: 9 },
    { handle: 'thejustinwelsh', verticals: ['one_person_business', 'indie_maker'], priority: 9 },
    { handle: 'dvassallo', verticals: ['indie_maker', 'mindset'], priority: 8 },
    { handle: 'arvidkahl', verticals: ['indie_maker'], priority: 8 },

    // Direct Response / High Conversion Copy
    { handle: 'AlexHormozi', verticals: ['direct_response', 'copywriting'], priority: 10 },
    { handle: 'harrydry', verticals: ['copywriting'], priority: 9 },
    { handle: 'StefanGeorgi', verticals: ['direct_response', 'copywriting'], priority: 8 },

    // Thread Systems & Writing
    { handle: 'Nicolascole77', verticals: ['thread_systems', 'audience_building'], priority: 9 },
    { handle: 'dickiebush', verticals: ['thread_systems', 'audience_building'], priority: 9 },
    { handle: 'heyblake', verticals: ['thread_systems', 'copywriting'], priority: 9 },

    // Visual / Design Thinking
    { handle: 'jackbutcher', verticals: ['visual_design', 'mindset'], priority: 9 },

    // Audience Building / Newsletter
    { handle: 'SahilBloom', verticals: ['audience_building', 'mindset'], priority: 8 },

    // Add more aggressively here - aim for 100-200 high-signal accounts
    // Finance, health, AI, design systems, etc.
    // Indie / Maker
    { handle: 'visakanv', verticals: ['mindset', 'one_person_business'], priority: 7 },
    { handle: 'shl', verticals: ['indie_maker'], priority: 7 },
    { handle: 'patwalls', verticals: ['indie_maker'], priority: 7 },
    // Copy & Marketing
    { handle: 'copywriting', verticals: ['copywriting'], priority: 8 },
    { handle: 'garyvee', verticals: ['mindset', 'audience_building'], priority: 6 },
    // AI / Tech Builders
    { handle: 'levelsio', verticals: ['indie_maker', 'ai'], priority: 10 }, // already there but reinforce
    { handle: 'swyx', verticals: ['ai', 'audience_building'], priority: 8 },
    { handle: 'gdb', verticals: ['ai', 'mindset'], priority: 7 },
    // Design & Visual
    { handle: 'visualizevalue', verticals: ['visual_design'], priority: 8 },
    // Finance / Wealth
    { handle: 'naval', verticals: ['mindset'], priority: 7 },
    { handle: 'SahilBloom', verticals: ['audience_building', 'mindset'], priority: 8 },
    // Writing & Ideas
    { handle: 'david_perell', verticals: ['thread_systems', 'audience_building'], priority: 8 },
    { handle: 'jamesclear', verticals: ['mindset'], priority: 6 },
    // More high-engagement
    { handle: 'arvidkahl', verticals: ['indie_maker'], priority: 8 },
    { handle: 'thepatwalls', verticals: ['indie_maker'], priority: 7 },
    // Additional from Imagine-style research (LinkedIn/creator GTM signals on X)
    { handle: 'garyvee', verticals: ['mindset', 'audience_building'], priority: 7 },
    { handle: 'copywriting', verticals: ['copywriting'], priority: 8 },
    { handle: 'swyx', verticals: ['ai', 'audience_building'], priority: 8 },
    { handle: 'naval', verticals: ['mindset'], priority: 7 },
    { handle: 'visualizevalue', verticals: ['visual_design'], priority: 8 },
    { handle: 'pitdesi', verticals: ['mindset', 'indie_maker'], priority: 6 },
    { handle: 'dailycopywriter', verticals: ['copywriting'], priority: 8 },
    { handle: 'grace_ugc', verticals: ['audience_building'], priority: 7 },
  ],
  keywords: [
    'how I made', 'revenue', '$', 'hook', 'thread', 'went from', 'to $',
    'copywriting', 'offer', 'conversion', 'engagement'
  ],
  refreshIntervalHours: 6,
};

export const VERTICAL_LABELS: Record<HookVertical, string> = {
  indie_maker: 'Indie Maker',
  direct_response: 'Direct Response',
  thread_systems: 'Thread Systems',
  one_person_business: 'One-Person Business',
  visual_design: 'Visual Design',
  audience_building: 'Audience Building',
  mindset: 'Mindset & Philosophy',
  copywriting: 'Copywriting',
  ai: 'AI & Tech',
  tech: 'Technology',
  general: 'General',
};
