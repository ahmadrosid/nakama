import { describe, expect, test } from "bun:test";
import type {
  StoredChannelOrgMappingRecord,
  StoredOrganizationRecord,
  StoredOrgMemberRecord,
  StoredProfileRecord,
} from "./types";

describe("org types", () => {
  test("tenant records accept optional orgId", () => {
    const profile: StoredProfileRecord = {
      id: "profile_1",
      name: "Bot",
      systemPrompt: "",
      model: null,
      isSuper: false,
      orgId: "org_acme",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    };

    expect(profile.orgId).toBe("org_acme");
  });

  test("organization and membership record shapes", () => {
    const org: StoredOrganizationRecord = {
      id: "org_acme",
      name: "Acme",
      slug: "acme",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    };

    const member: StoredOrgMemberRecord = {
      orgId: org.id,
      userId: "user_1",
      role: "admin",
      createdAt: "2026-06-21T00:00:00.000Z",
    };

    const mapping: StoredChannelOrgMappingRecord = {
      channel: "telegram",
      channelUserId: "tg_123",
      userId: member.userId,
      orgId: org.id,
      createdAt: "2026-06-21T00:00:00.000Z",
    };

    expect(member.role).toBe("admin");
    expect(mapping.channel).toBe("telegram");
  });
});
