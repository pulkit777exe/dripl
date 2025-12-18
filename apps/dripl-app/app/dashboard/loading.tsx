export default function DashboardLoading() {
  return (
    <div className="flex-1 p-8 overflow-auto bg-background">
      <div className="flex gap-4 mb-12">
        <div className="w-48 h-32 rounded-xl border border-border bg-card animate-pulse" />
      </div>
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-card rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}