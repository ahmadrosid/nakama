import type { ToolContext } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";

export function buildToolExecutionContext(context: ToolContext): ToolContext {
  if (context.workspaceRoot?.trim()) {
    return context;
  }

  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!(orgId && profileId)) {
    return context;
  }

  return {
    ...context,
    orgId,
    profileId,
    workspaceRoot: getProfileSoulDir(orgId, profileId),
  };
}
