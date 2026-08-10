export function ArtifactGridSkeleton() {
  return (
    <ul
      aria-hidden
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 p-3"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <li
          className="overflow-hidden rounded-md border border-border"
          key={`artifact-grid-skeleton-${index}`}
        >
          <div className="skeleton-shimmer aspect-[4/3] w-full" />
          <div className="space-y-2 p-3">
            <div className="skeleton-shimmer h-4 w-3/4 rounded" />
            <div className="skeleton-shimmer h-3 w-1/2 rounded" />
            <div className="skeleton-shimmer h-3 w-2/3 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}
