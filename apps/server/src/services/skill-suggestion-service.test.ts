import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaApiError } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
  seedOrgDefaultProfile,
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
  } = {}
) {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Test Org",
    skillsWriteApproval: options.orgSkillsWriteApproval ?? false,
    slug: "test-org",
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
  return { proposals, skills, suggestions };
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
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId: profile.id,
      proposedByUserId: "user_1",
      sessionId: "session_1",
    });

    expect(created.status).toBe("pending");
    expect(created.skillName).toBe("deploy-notes");
    expect(created.source).toBe("post_turn_review");

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(
      false
    );

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
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId: profile.id,
    });

    const result = await suggestions.applySuggestion(
      ORG_ID,
      created.id,
      "admin_user"
    );
    expect(result.outcome).toBe("applied");
    expect(result.suggestion.status).toBe("applied");
    expect(result.suggestion.appliedAt).toBeTruthy();

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(
      true
    );
  });

  test("apply is idempotent when suggestion is already applied", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db, { orgSkillsWriteApproval: false });
    const { suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId: profile.id,
    });

    const first = await suggestions.applySuggestion(
      ORG_ID,
      created.id,
      "admin_user"
    );
    expect(first.outcome).toBe("applied");

    const second = await suggestions.applySuggestion(
      ORG_ID,
      created.id,
      "admin_user"
    );
    expect(second.outcome).toBe("already_applied");
  });

  test("gate-flip on apply: suggested under gate-off, gate flips on, apply stages a proposal instead of writing", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db, { orgSkillsWriteApproval: false });
    const { skills, proposals, suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId: profile.id,
      sessionId: "session_1",
    });

    // Gate flips on after the suggestion was created but before it's applied.
    const org = await db.getOrganizationById(ORG_ID);
    await db.upsertOrganization({ ...org!, skillsWriteApproval: true });

    const result = await suggestions.applySuggestion(
      ORG_ID,
      created.id,
      "admin_user"
    );
    expect(result.outcome).toBe("staged_as_proposal");
    expect(result.proposalId).toBeTruthy();
    expect(result.suggestion.status).toBe("applied");

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(
      false
    );

    const { proposals: pending } = await proposals.listProposals(ORG_ID, {
      profileId: profile.id,
    });
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
      action: "patch",
      appliedAt: null,
      content: null,
      createdAt: new Date().toISOString(),
      id: "sksug_bundled",
      orgId: ORG_ID,
      patchNewString: "new",
      patchOldString: "old",
      profileId: profile.id,
      proposedByUserId: null,
      sessionId: null,
      skillName: "manage-skills",
      source: "post_turn_review",
      status: "pending",
      warnings: null,
    });

    await expect(
      suggestions.applySuggestion(ORG_ID, "sksug_bundled", "admin_user")
    ).rejects.toThrow(/bundled/i);
  });

  test("createSuggestion refuses bundled skill names", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const { suggestions } = buildServices(db);

    await expect(
      suggestions.createSuggestion({
        orgId: ORG_ID,
        outcome: {
          action: "patch",
          name: "manage-skills",
          newString: "b",
          oldString: "a",
        },
        profileId: profile.id,
      })
    ).rejects.toThrow(/bundled/i);
  });

  test("cross-org suggestion id returns 404 on apply", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const { suggestions } = buildServices(db);

    const created = await suggestions.createSuggestion({
      orgId: ORG_ID,
      outcome: {
        action: "create",
        content: sampleSkillMarkdown,
        name: "deploy-notes",
      },
      profileId: profile.id,
    });

    await expect(
      suggestions.applySuggestion("org_other", created.id, "admin_user")
    ).rejects.toBeInstanceOf(NakamaApiError);
    await expect(
      suggestions.applySuggestion("org_other", created.id, "admin_user")
    ).rejects.toMatchObject({ status: 404 });
  });
});
