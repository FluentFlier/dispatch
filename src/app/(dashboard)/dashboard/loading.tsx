export default function DashboardLoading() {
  return (
    <div className="page-shell-wide space-y-6">
      <div className="card-surface h-[280px] animate-pulse" />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-surface h-[116px] animate-pulse" />
        ))}
      </div>

      <div className="card-surface h-32 animate-pulse" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="card-surface h-48 animate-pulse" />
          <div className="card-surface h-56 animate-pulse" />
        </div>
        <aside className="space-y-6">
          <div className="card-surface h-40 animate-pulse" />
          <div className="card-surface h-32 animate-pulse" />
        </aside>
      </div>
    </div>
  );
}
