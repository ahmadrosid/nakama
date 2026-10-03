import path from "node:path";
import { NakamaApiError } from "../api-error";
import type { ToolContext } from "../contract";
import { getProfileSoulDir } from "../soul/resolve";

/** Viewers and tool calls without an organization role are denied. */
export function requireToolNotViewer(context: ToolContext): void {
  if (!context.orgRole || context.orgRole === "viewer") {
    throw new NakamaApiError("Forbidden", 403);
  }
}

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

  if (Boolean(orgId) !== Boolean(profileId)) {
    throw new Error(
      "orgId and profileId must both be set to derive workspaceRoot, or neither."
    );
  }

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
