export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Greeting skeleton */}
      <div className="h-7 w-64 mt-2 bg-bg-tertiary rounded animate-pulse" />

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-secondary border border-border shadow-card rounded-lg p-[13px_14px] space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-bg-tertiary rounded animate-pulse" />
              <div className="h-6 w-10 bg-bg-tertiary rounded animate-pulse" />
            </div>
            <div className="h-3 w-20 bg-bg-tertiary rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Middle row: Up Next + Prompt */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-bg-secondary border border-border shadow-card rounded-lg p-[13px_14px] space-y-3">
          <div className="h-3 w-16 bg-bg-tertiary rounded animate-pulse" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-[3px] h-8 bg-bg-tertiary rounded-r-[2px] animate-pulse" />
              <div className="h-4 flex-1 bg-bg-tertiary rounded animate-pulse" />
              <div className="h-5 w-16 bg-bg-tertiary rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="bg-bg-secondary border border-border shadow-card rounded-lg p-[13px_14px] space-y-3">
          <div className="h-3 w-28 bg-bg-tertiary rounded animate-pulse" />
          <div className="h-16 w-full bg-bg-tertiary rounded animate-pulse" />
        </div>
      </div>

      {/* Backlog skeleton */}
      <div className="bg-bg-secondary border border-border shadow-card rounded-lg p-[13px_14px] space-y-3">
        <div className="h-3 w-16 bg-bg-tertiary rounded animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-[6px] h-[6px] bg-bg-tertiary rounded-full animate-pulse" />
            <div className="h-4 flex-1 bg-bg-tertiary rounded animate-pulse" />
            <div className="h-5 w-14 bg-bg-tertiary rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Quick Actions skeleton */}
      <div className="space-y-3">
        <div className="h-3 w-24 bg-bg-tertiary rounded animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2 bg-bg-tertiary border border-border rounded-md p-[10px_14px]">
              <div className="w-[18px] h-[18px] bg-bg-tertiary rounded animate-pulse" />
              <div className="h-3 w-16 bg-bg-tertiary rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
