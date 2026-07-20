export const DEFAULT_BUNDLED_SKILL_NAMES = [
  "create-automation",
  "manage-skills",
  "update-profile-memory",
  "archive-profile-memory",
  "save-artifact",
  "composio-integrations",
] as const;

export const SUPER_BOT_BUNDLED_SKILL_NAMES = ["create-profile", "coding-delegation"] as const;

export const RUNTIME_ONLY_BUNDLED_SKILL_NAMES = [
  "coding-backend-codex",
  "coding-backend-claude-code",
  "coding-backend-opencode",
] as const;

/** Bundled skills that install/sync but are never auto-assigned (manual opt-in). */
export const OPT_IN_BUNDLED_SKILL_NAMES = ["agent-browser"] as const;

export const BUNDLED_SKILL_NAMES = [
  ...DEFAULT_BUNDLED_SKILL_NAMES,
  ...SUPER_BOT_BUNDLED_SKILL_NAMES,
  ...RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  ...OPT_IN_BUNDLED_SKILL_NAMES,
] as const;

export type BundledSkillName = (typeof BUNDLED_SKILL_NAMES)[number];
