/**
 * Restrained aurora light. Oil-slick coral / cyan / gold blobs on near-black,
 * drifting almost imperceptibly. Pure CSS gradients, no image assets.
 * Decorative only, so it sits behind content and ignores pointer events.
 */
export default function Aurora({
  className = '',
  intensity = 'normal',
}: {
  className?: string;
  intensity?: 'normal' | 'calm';
}) {
  const opacity = intensity === 'calm' ? 'opacity-50' : 'opacity-100';
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${opacity} ${className}`}
    >
      <div
        className="absolute -left-[10%] top-[-15%] h-[55vw] w-[55vw] rounded-full blur-[120px] animate-os-aurora-slow"
        style={{
          background:
            'radial-gradient(circle at center, rgba(255,107,74,0.32), transparent 62%)',
        }}
      />
      <div
        className="absolute right-[-12%] top-[8%] h-[48vw] w-[48vw] rounded-full blur-[130px] animate-os-aurora-slower"
        style={{
          background:
            'radial-gradient(circle at center, rgba(91,231,216,0.22), transparent 64%)',
        }}
      />
      <div
        className="absolute bottom-[-20%] left-[28%] h-[42vw] w-[42vw] rounded-full blur-[140px] animate-os-aurora-slow"
        style={{
          background:
            'radial-gradient(circle at center, rgba(215,181,109,0.18), transparent 66%)',
        }}
      />
    </div>
  );
}
