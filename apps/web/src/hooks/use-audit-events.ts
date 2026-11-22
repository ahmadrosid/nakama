import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export interface AuditEventsFilters {
  action?: string;
  category?: string;
  limit: number;
  offset: number;
  outcome?: "success" | "failure";
  search?: string;
}

interface UseAuditEventsArgs {
  filters: AuditEventsFilters;
  /** Platform admins read the whole installation through the platform API. */
  isPlatformAdmin: boolean;
  /** The org to read; the platform admin path passes it only as a cache key. */
  orgId: string;
}

export function useAuditEvents({
  filters,
  orgId,
  isPlatformAdmin,
}: UseAuditEventsArgs) {
  return useQuery({
    enabled: Boolean(orgId),
    placeholderData: (previous) => previous,
    queryFn: () =>
      isPlatformAdmin
        ? client.listAuditEvents(filters)
        : client.listOrgAuditEvents(orgId, filters),
    queryKey: queryKeys.auditEvents(orgId, JSON.stringify(filters)),
  });
}

export function useAuditEventCategories(
  orgId: string,
  isPlatformAdmin: boolean
) {
  return useQuery({
    enabled: Boolean(orgId),
    queryFn: () =>
      isPlatformAdmin
        ? client.listAuditEventCategories()
        : client.listOrgAuditEventCategories(orgId),
    queryKey: queryKeys.auditEventCategories(orgId),
  });
}
