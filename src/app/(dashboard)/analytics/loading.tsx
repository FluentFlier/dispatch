export default function AnalyticsLoading() {
  return (
    <div className="page-shell-wide space-y-6">
      <div className="h-24 animate-pulse rounded-xl border border-hair bg-white/60" />
      <div className="h-10 animate-pulse rounded-lg bg-paper2" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card-surface h-56 animate-pulse" />
      ))}
    </div>
  );
}
