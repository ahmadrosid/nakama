export function ArtifactListSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, index) => (
        <li
          className="flex items-center justify-between gap-3 px-4 py-3"
          key={`artifact-skeleton-${index}`}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="skeleton-shimmer mt-0.5 size-4 shrink-0 rounded" />
            <div className="min-w-0 space-y-1.5">
              <div className="skeleton-shimmer h-4 w-48 max-w-full rounded" />
              <div className="skeleton-shimmer h-3 w-64 max-w-full rounded" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="skeleton-shimmer size-8 rounded-md" />
            <div className="skeleton-shimmer size-8 rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}
