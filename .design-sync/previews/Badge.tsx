import { Badge } from 'content-os';

// Content lifecycle labels a creator sees across the board.
export function StatusLabels() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge className="bg-coral-light text-accent-primary">New</Badge>
      <Badge className="bg-sage-light text-accent-secondary">Trending</Badge>
      <Badge className="bg-amber-100 text-amber-800">Draft</Badge>
      <Badge className="bg-bg-tertiary text-text-tertiary">Scheduled</Badge>
    </div>
  );
}

// Content pillar tags used to categorize posts.
export function PillarTags() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge className="bg-coral-light text-accent-primary">Founder Story</Badge>
      <Badge className="bg-sage-light text-accent-secondary">How-To</Badge>
      <Badge className="bg-amber-100 text-amber-800">Hot Take</Badge>
    </div>
  );
}

// A badge sitting inline next to a post title, the way it appears in a feed row.
export function InContext() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        maxWidth: 340,
      }}
    >
      <span style={{ fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 14, fontWeight: 500 }}>
        7 hooks that stopped the scroll
      </span>
      <Badge className="bg-sage-light text-accent-secondary">Trending</Badge>
    </div>
  );
}
