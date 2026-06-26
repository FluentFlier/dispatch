import { Skeleton } from 'content-os';

// The base shapes: a text line, an avatar circle, and a media block.
export function Shapes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 320 }}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-10 rounded-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

// A realistic loading state for a post card: avatar, title lines, and a media block.
export function LoadingCard() {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 340, padding: 16, borderRadius: 12 }}
      className="bg-bg-secondary border border-border"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton className="h-10 w-10 rounded-full" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}
