import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaApiError } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
  type DatabaseAdapter,
} from "@nakama/db";
import { SkillProposalService } from "./skill-proposal-service";
import { SkillSuggestionService } from "./skill-suggestion-service";
import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

const sampleSkillMarkdown = `---
name: deploy-notes
description: Notes about deploy process.
---

Run the deploy checklist before shipping.
`;

async function seedOrg(
  db: DatabaseAdapter,
  options: {
    orgSkillsWriteApproval?: boolean;
    profileSkillsWriteApproval?: boolean | null;
  } = {},
) {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    skillsWriteApproval: options.orgSkillsWriteApproval ?? false,
    createdAt: now,
    updatedAt: now,
  });
  const profile = await seedOrgDefaultProfile(db, ORG_ID);
  if (options.profileSkillsWriteApproval !== undefined) {
    await db.upsertProfile({
      ...profile,
      skillsWriteApproval: options.profileSkillsWriteApproval,
      updatedAt: now,
    });
  }
  return profile;
}

function buildServices(db: DatabaseAdapter) {
  const skills = new SkillsService(db);
  const proposals = new SkillProposalService(db, skills);
  const suggestions = new SkillSuggestionService(db, skills, proposals);
  return { skills, proposals, suggestions };
}

describe("SkillSuggestionService", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-suggestions-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("createSuggestion inserts a pending row without writing to disk", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const { skills, suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      profileId: profile.id,
      sessionId: "session_1",
      proposedByUserId: "user_1",
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    expect(created.status).toBe("pending");
    expect(created.skillName).toBe("deploy-notes");
    expect(created.source).toBe("post_turn_review");

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(false);

    const rows = await suggestions.listSuggestions(ORG_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(created.id);
  });

  test("apply with write approval off writes the skill directly via SkillsService", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db, { orgSkillsWriteApproval: false });
    const { skills, suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      profileId: profile.id,
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    const result = await suggestions.applySuggestion(ORG_ID, created.id, "admin_user");
    expect(result.outcome).toBe("applied");
    expect(result.suggestion.status).toBe("applied");
    expect(result.suggestion.appliedAt).toBeTruthy();

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(true);
  });

  test("apply is idempotent when suggestion is already applied", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db, { orgSkillsWriteApproval: false });
    const { suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      profileId: profile.id,
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    const first = await suggestions.applySuggestion(ORG_ID, created.id, "admin_user");
    expect(first.outcome).toBe("applied");

    const second = await suggestions.applySuggestion(ORG_ID, created.id, "admin_user");
    expect(second.outcome).toBe("already_applied");
  });

  test("gate-flip on apply: suggested under gate-off, gate flips on, apply stages a proposal instead of writing", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db, { orgSkillsWriteApproval: false });
    const { skills, proposals, suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      profileId: profile.id,
      sessionId: "session_1",
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    // Gate flips on after the suggestion was created but before it's applied.
    const org = await db.getOrganizationById(ORG_ID);
    await db.upsertOrganization({ ...org!, skillsWriteApproval: true });

    const result = await suggestions.applySuggestion(ORG_ID, created.id, "admin_user");
    expect(result.outcome).toBe("staged_as_proposal");
    expect(result.proposalId).toBeTruthy();
    expect(result.suggestion.status).toBe("applied");

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(false);

    const { proposals: pending } = await proposals.listProposals(ORG_ID, { profileId: profile.id });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(result.proposalId!);
    expect(pending[0]?.status).toBe("pending");
  });

  test("apply refuses bundled skill names", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const { suggestions } = buildServices(db);

    // Directly persist a suggestion targeting a bundled skill (bypassing the
    // createSuggestion guard) to exercise the apply-time guard too.
    await db.createSkillSuggestion({
      id: "sksug_bundled",
      orgId: ORG_ID,
      profileId: profile.id,
      sessionId: null,
      proposedByUserId: null,
      action: "patch",
      skillName: "manage-skills",
      content: null,
      patchOldString: "old",
      patchNewString: "new",
      status: "pending",
      source: "post_turn_review",
      warnings: null,
      createdAt: new Date().toISOString(),
      appliedAt: null,
    });

    await expect(
      suggestions.applySuggestion(ORG_ID, "sksug_bundled", "admin_user"),
    ).rejects.toThrow(/bundled/i);
  });

  test("createSuggestion refuses bundled skill names", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const { suggestions } = buildServices(db);

    await expect(
      suggestions.createSuggestion({
        orgId: ORG_ID,
        profileId: profile.id,
        outcome: { action: "patch", name: "manage-skills", oldString: "a", newString: "b" },
      }),
    ).rejects.toThrow(/bundled/i);
  });

  test("cross-org suggestion id returns 404 on apply", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const { suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      profileId: profile.id,
      outcome: { action: "create", name: "deploy-notes", content: sampleSkillMarkdown },
    });

    await expect(
      suggestions.applySuggestion("org_other", created.id, "admin_user"),
    ).rejects.toBeInstanceOf(NakamaApiError);
    await expect(
      suggestions.applySuggestion("org_other", created.id, "admin_user"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
