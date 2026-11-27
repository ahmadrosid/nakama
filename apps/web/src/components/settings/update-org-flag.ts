import type { UpdateOrganizationRequest } from "@nakama/core/contract";
import { toast } from "@nakama/ui/toast";
import type { Dispatch, SetStateAction } from "react";
import type { AuthContextValue } from "@/context/auth-context-shared";
import { formatError } from "@/lib/client";

export async function updateOrgFlag(
  updateOrg: AuthContextValue["updateOrg"],
  orgId: string,
  patch: UpdateOrganizationRequest,
  setBusyOrgId: Dispatch<SetStateAction<string | null>>
): Promise<void> {
  setBusyOrgId(orgId);

  try {
    await updateOrg(orgId, patch);
  } catch (error) {
    toast(formatError(error));
  } finally {
    setBusyOrgId((busyOrgId) => (busyOrgId === orgId ? null : busyOrgId));
  }
}
