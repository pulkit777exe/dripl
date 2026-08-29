export default function DashboardLoading() {
  return (
    <div
      className="flex-1 p-8 overflow-auto"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="flex gap-4 mb-12">
        <div
          className="w-48 h-32 rounded-xl animate-pulse"
          style={{
            backgroundColor: 'var(--color-card)',
            border: '1px solid var(--color-border)',
          }}
        />
      </div>
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-12 rounded animate-pulse"
            style={{ backgroundColor: 'var(--color-card)' }}
          />
        ))}
      </div>
    </div>
  );
}
