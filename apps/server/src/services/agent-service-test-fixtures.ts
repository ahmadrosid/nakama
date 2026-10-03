import type { StoredProfileRecord } from "@nakama/db";

export function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    id: "profile_default",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default",
    orgId: "org_test",
    systemPrompt: "You are helpful.",
    updatedAt: now,
  };
}
