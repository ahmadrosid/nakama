import path from "node:path";
import type { ToolContext } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";

export function buildToolExecutionContext(context: ToolContext): ToolContext {
  if (context.workspaceRoot?.trim()) {
    const workspaceRoot = context.workspaceRoot.trim();
    if (!path.isAbsolute(workspaceRoot)) {
      throw new Error(
        "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
      );
    }
    return { ...context, workspaceRoot };
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
