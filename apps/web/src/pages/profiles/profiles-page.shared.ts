import type { ProfileSummary } from "@nakama/core/contract";

export const sectionClass = "rounded-md border border-border bg-card";
export const profilesTagline = "Separate prompt, tools, and knowledge for each bot.";
export const profileTextSaveDelayMs = 1000;
export const profileModelSaveDelayMs = 400;

export type ProfileSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type ProfileDetailTab = "profile" | "prompt" | "knowledge" | "artifacts";

export function resolveProfileDetailTab(value: string | null): ProfileDetailTab {
  if (value === "prompt" || value === "knowledge" || value === "artifacts") {
    return value;
  }

  if (value === "soul") {
    return "prompt";
  }

  return "profile";
}

export type ProfileEditSnapshot = {
  editName: string;
  editPrompt: string;
  editModel: string | null;
  savedName: string;
  savedPrompt: string;
  savedModel: string | null;
};

export function profileHasPendingEdits(snapshot: ProfileEditSnapshot): boolean {
  const name = snapshot.editName.trim();
  if (!name) {
    return false;
  }

  return (
    name !== snapshot.savedName ||
    snapshot.editPrompt !== snapshot.savedPrompt ||
    snapshot.editModel !== snapshot.savedModel
  );
}

export type RemoveAssignmentTarget =
  | { kind: "tool"; id: string; name: string }
  | { kind: "mcp"; id: string; name: string }
  | { kind: "skill"; id: string; name: string }
  | { kind: "composio"; id: string; name: string };

export function profileSidebarDescription(profile: ProfileSummary): string {
  if (profile.isSuper) {
    return "Super bot";
  }

  const parts: string[] = [];

  if (profile.toolCount > 0) {
    parts.push(`${profile.toolCount} tool${profile.toolCount === 1 ? "" : "s"}`);
  }

  if (profile.mcpServerCount > 0) {
    parts.push(`${profile.mcpServerCount} MCP`);
  }

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  return profile.isDefault ? "Default profile" : profile.id;
}