import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaApiError } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { SkillProposalService } from "./skill-proposal-service";
import { SkillsService } from "./skills-service";
import {
  ORG_ID,
  seedSkillOrg as seedOrg,
} from "./skills-service-test-fixtures";

const sampleSkillMarkdown = `---
name: deploy-notes
description: Notes about deploy process.
---

Run the deploy checklist before shipping.
`;

describe("SkillProposalService", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-proposals-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("isWriteApprovalRequired respects org default and profile override (AE7)", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db, {
      orgSkillsWriteApproval: true,
      profileSkillsWriteApproval: false,
    });
    const service = new SkillProposalService(db);

    expect(await service.isWriteApprovalRequired(ORG_ID, profile.id)).toBe(
      false
    );
  });

  test("stage create inserts pending row without writing skill to disk", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    const result = await service.stageProposal({
      action: "create",
      content: sampleSkillMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
    });

    expect(result.outcome).toBe("created");
    expect(result.proposalId).toBeTruthy();

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(
      false
    );

    const { proposals } = await service.listProposals(ORG_ID, {
      profileId: profile.id,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("pending");
    expect(proposals[0]?.action).toBe("create");
  });

  test("duplicate pending create returns already_pending (AE3)", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const service = new SkillProposalService(db, new SkillsService(db));

    const first = await service.stageProposal({
      action: "create",
      content: sampleSkillMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
    });
    const second = await service.stageProposal({
      action: "create",
      content: sampleSkillMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
    });

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("already_pending");
    expect(second.proposalId).toBe(first.proposalId);

    const { proposals } = await service.listProposals(ORG_ID, {
      profileId: profile.id,
    });
    expect(proposals).toHaveLength(1);
  });

  test("approve create applies skill via SkillsService", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    const staged = await service.stageProposal({
      action: "create",
      content: sampleSkillMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
    });

    const approved = await service.approveProposal(
      ORG_ID,
      staged.proposalId!,
      "admin_user"
    );
    expect(approved.status).toBe("approved");

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(
      true
    );

    const again = await service.approveProposal(
      ORG_ID,
      staged.proposalId!,
      "admin_user"
    );
    expect(again.status).toBe("approved");
  });

  test("reject leaves disk unchanged", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    const staged = await service.stageProposal({
      action: "create",
      content: sampleSkillMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
    });

    const rejected = await service.rejectProposal(
      ORG_ID,
      staged.proposalId!,
      "admin_user"
    );
    expect(rejected.status).toBe("rejected");

    const listed = await skills.listSkills();
    expect(listed.skills.some((skill) => skill.name === "deploy-notes")).toBe(
      false
    );
  });

  test("stage patch requires an existing profile-owned skill", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    await skills.createSkill(ORG_ID, {
      body: "Run the deploy checklist before shipping.",
      description: "Notes about deploy process.",
      name: "deploy-notes",
      profileId: profile.id,
    });

    const result = await service.stageProposal({
      action: "patch",
      newString: "release checklist",
      oldString: "deploy checklist",
      orgId: ORG_ID,
      profileId: profile.id,
      skillName: "deploy-notes",
    });

    expect(result.outcome).toBe("created");
  });

  test("approve patch applies old_string/new_string", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    const created = await skills.createSkill(ORG_ID, {
      body: "Run the deploy checklist before shipping.",
      description: "Notes about deploy process.",
      name: "deploy-notes",
      profileId: profile.id,
    });

    const staged = await service.stageProposal({
      action: "patch",
      newString: "release checklist",
      oldString: "deploy checklist",
      orgId: ORG_ID,
      profileId: profile.id,
      skillName: "deploy-notes",
    });

    await service.approveProposal(ORG_ID, staged.proposalId!, "admin_user");

    const detail = await skills.getSkill(created.skill.id);
    expect(detail.skill.body).toContain("release checklist");
    expect(detail.skill.body).not.toContain("deploy checklist");
  });

  test("stage delete blocks when another pending proposal exists for the skill", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    const created = await skills.createSkill(ORG_ID, {
      body: "Run the deploy checklist before shipping.",
      description: "Notes about deploy process.",
      name: "deploy-notes",
      profileId: profile.id,
    });

    const patchStaged = await service.stageProposal({
      action: "patch",
      newString: "release checklist",
      oldString: "deploy checklist",
      orgId: ORG_ID,
      profileId: profile.id,
      skillName: "deploy-notes",
    });
    expect(patchStaged.outcome).toBe("created");

    const deleteStaged = await service.stageProposal({
      action: "delete",
      orgId: ORG_ID,
      profileId: profile.id,
      skillName: "deploy-notes",
    });
    expect(deleteStaged.outcome).toBe("already_pending");
    expect(deleteStaged.proposalId).toBe(patchStaged.proposalId);

    const detail = await skills.getSkill(created.skill.id);
    expect(detail.skill.body).toContain("deploy checklist");
  });

  test("cross-org proposal id returns 404 on approve (AE6)", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const service = new SkillProposalService(db, new SkillsService(db));

    const staged = await service.stageProposal({
      action: "create",
      content: sampleSkillMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
    });

    await expect(
      service.approveProposal("org_other", staged.proposalId!, "admin_user")
    ).rejects.toBeInstanceOf(NakamaApiError);
    await expect(
      service.approveProposal("org_other", staged.proposalId!, "admin_user")
    ).rejects.toMatchObject({ status: 404 });
  });

  test("stage and approve write_file creates supporting file", async () => {
    const { readFile } = await import("node:fs/promises");
    const { getProfileSkillsDir } = await import("@nakama/core");

    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    await skills.createAndAssignRawSkillToProfile(
      ORG_ID,
      profile.id,
      sampleSkillMarkdown
    );

    const staged = await service.stageProposal({
      action: "write_file",
      content: "- staging\n",
      orgId: ORG_ID,
      profileId: profile.id,
      relativePath: "checklist.md",
      skillName: "deploy-notes",
    });
    expect(staged.outcome).toBe("created");
    expect(
      (await service.listProposals(ORG_ID, { profileId: profile.id }))
        .proposals[0]?.relativePath
    ).toBe("checklist.md");

    await service.approveProposal(ORG_ID, staged.proposalId!, "admin_user");

    const onDisk = await readFile(
      join(
        getProfileSkillsDir(ORG_ID, profile.id),
        "deploy-notes",
        "checklist.md"
      ),
      "utf8"
    );
    expect(onDisk).toContain("- staging");
  });

  test("approve edit with consolidate losers archives them without delete", async () => {
    const { pathExists } = await import("@nakama/core");
    const { getProfileSkillsArchiveDir, getProfileSkillsDir } = await import(
      "@nakama/core"
    );

    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrg(db);
    const skills = new SkillsService(db);
    const service = new SkillProposalService(db, skills);

    const winnerMarkdown = `---
name: deploy-helper
description: Deploy checklist helper.
---

Winner body.
`;
    const loserMarkdown = `---
name: deploy-assistant
description: Deploy checklist assistant.
---

Loser body.
`;
    const mergedMarkdown = `---
name: deploy-helper
description: Deploy checklist helper.
---

Merged body.
`;

    await skills.createAndAssignRawSkillToProfile(
      ORG_ID,
      profile.id,
      winnerMarkdown
    );
    await skills.createAndAssignRawSkillToProfile(
      ORG_ID,
      profile.id,
      loserMarkdown
    );

    const staged = await service.stageProposal({
      action: "edit",
      consolidateLoserSkillNames: ["deploy-assistant"],
      content: mergedMarkdown,
      orgId: ORG_ID,
      profileId: profile.id,
      skillName: "deploy-helper",
    });
    expect(staged.outcome).toBe("created");

    const listed = await service.listProposals(ORG_ID, {
      profileId: profile.id,
    });
    expect(listed.proposals[0]?.consolidateLoserSkillNames).toEqual([
      "deploy-assistant",
    ]);

    await service.approveProposal(ORG_ID, staged.proposalId!, "admin_user");

    const assigned = await skills.listSkillsForProfile(profile.id);
    expect(assigned.map((skill) => skill.name).sort()).toEqual([
      "deploy-helper",
    ]);

    expect(
      await pathExists(
        join(getProfileSkillsDir(ORG_ID, profile.id), "deploy-helper")
      )
    ).toBe(true);
    expect(
      await pathExists(
        join(getProfileSkillsDir(ORG_ID, profile.id), "deploy-assistant")
      )
    ).toBe(false);
    expect(
      await pathExists(
        join(getProfileSkillsArchiveDir(ORG_ID, profile.id), "deploy-assistant")
      )
    ).toBe(true);
  });
});
