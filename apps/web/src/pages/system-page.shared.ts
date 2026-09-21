import { PAGE_PATHS } from "@/lib/navigation";

export function legacySystemDestination(
  searchParams: URLSearchParams,
  isPlatformAdmin: boolean
): string {
  const next = new URLSearchParams(searchParams);
  const tab = next.get("tab");
  next.delete("tab");
  let path: string = PAGE_PATHS.tools;
  if (tab === "mcp" && isPlatformAdmin) {
    path = PAGE_PATHS.mcp;
  }
  if (tab === "usage") {
    path = PAGE_PATHS.usage;
  }
  if (tab === "plugins") {
    path = PAGE_PATHS["plugin-management"];
  }
  if (tab === "status") {
    path = PAGE_PATHS.workers;
  }
  if (tab === "organization") {
    path = PAGE_PATHS.organization;
  }
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}
