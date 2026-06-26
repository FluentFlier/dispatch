import { SkeletonLines } from 'content-os';

// Three placeholder lines while a caption draft loads (last line shorter by design).
export function ThreeLines() {
  return (
    <div style={{ maxWidth: 320 }}>
      <SkeletonLines count={3} />
    </div>
  );
}

// Five lines, for a longer body of generating content like a LinkedIn post.
export function FiveLines() {
  return (
    <div style={{ maxWidth: 320 }}>
      <SkeletonLines count={5} />
    </div>
  );
}
