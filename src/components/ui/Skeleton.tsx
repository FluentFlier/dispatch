interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    // bg-bg-tertiary, matching the page-level skeletons. The old bg-paper2/90
    // was within a hair of bg-bg-secondary, so a skeleton drawn on a secondary
    // card was invisible - the loading state was rendering the whole time and
    // read as a blank box, then content appeared with no warning.
    <div
      className={`animate-pulse rounded bg-bg-tertiary ${className}`}
    />
  );
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === count - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}
