/**
 * Simple Engager Categorization (Imagine-inspired actionable analytics)
 * 
 * Instead of vanity metrics, bucket engagers (from inbox or mined data) into:
 * - ICP (Ideal Customer Profile)
 * - Community
 * - Potential Leads
 * - Others
 * 
 * This makes our Engagement Inbox + Hook Intelligence much more valuable,
 * similar to the leads breakdown the user trialed in Imagine.
 */

export type EngagerCategory = 'ICP' | 'Community' | 'Potential Lead' | 'Other';

export interface Engager {
  name?: string;
  handle?: string;
  bio?: string;
  engagementType: 'like' | 'comment' | 'follow';
}

export function categorizeEngager(engager: Engager, targetKeywords: string[] = []): EngagerCategory {
  const text = `${engager.name || ''} ${engager.handle || ''} ${engager.bio || ''}`.toLowerCase();

  // Very simple heuristic rules (can be upgraded with LLM or ML later)
  const isICP = targetKeywords.some(k => text.includes(k.toLowerCase())) || 
                text.includes('founder') || text.includes('ceo') || text.includes('builder');

  if (isICP) return 'ICP';

  if (text.includes('writer') || text.includes('designer') || text.includes('creator') || 
      text.includes('indie') || text.includes('maker')) {
    return 'Community';
  }

  if (engager.engagementType === 'comment' && (text.includes('?') || text.includes('how') || text.includes('love this'))) {
    return 'Potential Lead';
  }

  return 'Other';
}

export function bucketEngagers(engagers: Engager[], targetKeywords: string[] = []) {
  const buckets: Record<EngagerCategory, Engager[]> = {
    'ICP': [],
    'Community': [],
    'Potential Lead': [],
    'Other': []
  };

  for (const e of engagers) {
    const cat = categorizeEngager(e, targetKeywords);
    buckets[cat].push(e);
  }

  return buckets;
}
