/**
 * Engager/Lead Categorization (Imagine architecture pattern, replicated better for multi-platform)
 * Buckets engagers from our inbox/mined data into ICP, Community, Potential Lead, Other.
 * Makes analytics actionable (not vanity), feeds RL/optimizer.
 * No direct code from Imagine trial.
 */
export type Category = 'ICP' | 'Community' | 'Potential Lead' | 'Other';

export interface Engager {
  name?: string;
  handle?: string;
  text?: string; // bio, comment, etc.
  platform?: string;
  engagementType?: 'comment' | 'like' | 'repost' | 'follow';
}

export function categorize(engager: Engager, userPillars: string[] = [], userICPKeywords: string[] = []): Category {
  const content = `${engager.name || ''} ${engager.handle || ''} ${engager.text || ''}`.toLowerCase();
  
  // ICP: Matches user's pillars/keywords or strong buying signals
  if (userICPKeywords.some(k => content.includes(k.toLowerCase())) || 
      userPillars.some(p => content.includes(p.toLowerCase())) ||
      content.includes('founder') || content.includes('ceo') || content.includes('head of')) {
    return 'ICP';
  }
  
  // Community: Peers, creators, industry
  if (content.includes('creator') || content.includes('indie') || content.includes('builder') ||
      content.includes('writer') || content.includes('designer') || content.includes('maker')) {
    return 'Community';
  }
  
  // Potential Lead: High engagement + questions/interest signals
  if (engager.engagementType === 'comment' && 
      (content.includes('?') || content.includes('how') || content.includes('love') || content.includes('this is great'))) {
    return 'Potential Lead';
  }
  
  return 'Other';
}

export function bucketEngagers(engagers: Engager[], userPillars: string[] = [], userICPKeywords: string[] = []) {
  const buckets: Record<Category, Engager[]> = { 'ICP': [], 'Community': [], 'Potential Lead': [], 'Other': [] };
  for (const e of engagers) {
    buckets[categorize(e, userPillars, userICPKeywords)].push(e);
  }
  return buckets;
}
