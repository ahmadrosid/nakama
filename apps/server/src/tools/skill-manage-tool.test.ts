import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@nakama/core";
import { pathExists, runWriteFile } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
} from "@nakama/db";
import { SkillProposalService } from "../services/skill-proposal-service";
import { SkillsService } from "../services/skills-service";
import { createSkillManageTools } from "./skill-manage-tool";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

const researchSkillMarkdown = `---
name: research-paper
description: Research a paper. Use when the user asks to dig into a research paper.
include-body-on-match: true
---

1. Search for the paper title.
2. Summarize contributions and limitations.
`;

function memberContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    orgId: ORG_ID,
    orgRole: "member",
    profileId: PROFILE_ID,
    ...overrides,
  };
}

function skillManageTool(
  service: SkillsService,
  skillProposalService?: SkillProposalService | null
) {
  const [tool] = createSkillManageTools({
    skillProposalService: skillProposalService ?? null,
    skillsService: service,
  });
  if (!tool) {
    throw new Error("skill_manage tool missing");
  }
  return tool;
}

async function seedOrgProfile(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
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

describe("skill_manage tool", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  async function setup() {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-manage-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    return { db, service, tool: skillManageTool(service) };
  }

  test("create assigns skill and makes it matchable", async () => {
    const { db, service, tool } = await setup();

    const result = await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );

    expect(result).toMatchObject({
      action: "create",
      assigned: true,
      created: true,
      name: "research-paper",
    });
    expect(String((result as { matchHint?: string }).matchHint)).toContain(
      "assigned"
    );

    const assigned = await db.listSkillsForProfile(PROFILE_ID);
    expect(assigned.map((skill) => skill.name)).toContain("research-paper");

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Please research a paper on transformers"
    );
    expect(matched).toContain("Active Skill: research-paper");
  });

  test("invalidates the current session catalog after live create and delete", async () => {
    const { tool } = await setup();
    let invalidations = 0;
    const context = memberContext({
      onSkillCatalogChange: () => {
        invalidations += 1;
      },
    });

    await tool.run(
      { action: "create", content: researchSkillMarkdown },
      context
    );
    await tool.run({ action: "delete", name: "research-paper" }, context);

    expect(invalidations).toBe(2);
  });

  test("create adopts an existing unassigned profile skill directory", async () => {
    const { db, tool } = await setup();
    const leftoverDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "research-paper"
    );
    await mkdir(leftoverDir, { recursive: true });
    await writeFile(
      join(leftoverDir, "SKILL.md"),
      researchSkillMarkdown,
      "utf8"
    );

    const result = await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );

    expect(result).toMatchObject({
      action: "create",
      assigned: true,
      created: false,
      name: "research-paper",
    });

    const assigned = await db.listSkillsForProfile(PROFILE_ID);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.name).toBe("research-paper");
  });

  test("patch updates disk and DB description", async () => {
    const { db, service, tool } = await setup();
    await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );

    const result = await tool.run(
      {
        action: "patch",
        name: "research-paper",
        new_string: "Summarize contributions, methods, and limitations.",
        old_string: "Summarize contributions and limitations.",
      },
      memberContext()
    );

    expect(result).toMatchObject({
      action: "patch",
      assigned: true,
      name: "research-paper",
    });

    const onDisk = await readFile(
      join(
        configDir,
        "orgs",
        ORG_ID,
        "profiles",
        PROFILE_ID,
        "skills",
        "research-paper",
        "SKILL.md"
      ),
      "utf8"
    );
    expect(onDisk).toContain("methods, and limitations");

    const skill = (await db.listSkills()).find(
      (entry) => entry.name === "research-paper"
    );
    expect(skill?.description).toContain("Research a paper");

    const detail = await service.getSkill(skill!.id);
    expect(detail.skill.body).toContain("methods, and limitations");
  });

  test("delete removes assignment, DB row, and directory", async () => {
    const { db, tool } = await setup();
    await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );

    const skillDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "research-paper"
    );
    expect(await pathExists(skillDir)).toBe(true);

    const result = await tool.run(
      { action: "delete", name: "research-paper" },
      memberContext()
    );

    expect(result).toMatchObject({
      action: "delete",
      assigned: false,
      name: "research-paper",
    });
    expect(String((result as { matchHint?: string }).matchHint)).toContain(
      "removed"
    );
    expect(String((result as { matchHint?: string }).matchHint)).not.toContain(
      "is assigned for this profile"
    );
    expect(await pathExists(skillDir)).toBe(false);
    expect(await db.listSkillsForProfile(PROFILE_ID)).toHaveLength(0);
    expect(
      (await db.listSkills()).some((skill) => skill.name === "research-paper")
    ).toBe(false);
  });

  test("create adopts identical assigned skill but refuses content overwrite", async () => {
    const { tool } = await setup();
    await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );

    const identical = await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );
    expect(identical).toMatchObject({
      action: "create",
      assigned: true,
      created: false,
      name: "research-paper",
    });

    await expect(
      tool.run(
        {
          action: "create",
          content: `---
name: research-paper
description: Research a paper and summarize it.
include-body-on-match: true
---

Completely different body.
`,
        },
        memberContext()
      )
    ).rejects.toThrow(/already assigned.*patch/i);
  });

  test("refuses bundled skill names on create", async () => {
    const { tool } = await setup();

    await expect(
      tool.run(
        {
          action: "create",
          content: `---
name: manage-skills
description: Should not be creatable.
---

Nope.
`,
        },
        memberContext()
      )
    ).rejects.toThrow(/Bundled system skill/);
  });

  test("refuses colliding name that already exists outside profile skills dir", async () => {
    const { db, tool } = await setup();
    const globalDir = join(configDir, "agent", "skills", "weather");
    await mkdir(globalDir, { recursive: true });
    await writeFile(
      join(globalDir, "SKILL.md"),
      `---
name: weather
description: Global weather skill.
---

Global body.
`,
      "utf8"
    );

    await db.upsertSkill({
      createdAt: new Date().toISOString(),
      createdBy: "bundled",
      description: "Global weather skill.",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_weather_global",
      name: "weather",
      sourcePath: globalDir,
      updatedAt: new Date().toISOString(),
    });

    await expect(
      tool.run(
        {
          action: "create",
          content: `---
name: weather
description: Profile weather skill.
---

Profile body.
`,
        },
        memberContext()
      )
    ).rejects.toThrow(/different source path/);
  });

  test("refuses viewer role", async () => {
    const { tool } = await setup();

    await expect(
      tool.run(
        { action: "create", content: researchSkillMarkdown },
        memberContext({ orgRole: "viewer" })
      )
    ).rejects.toThrow("Viewers cannot manage skills.");
  });

  test("refuses missing orgRole", async () => {
    const { tool } = await setup();

    await expect(
      tool.run(
        { action: "create", content: researchSkillMarkdown },
        memberContext({ orgRole: undefined })
      )
    ).rejects.toThrow("skill_manage requires an organization role.");
  });

  test("refuses automationId context", async () => {
    const { tool } = await setup();

    await expect(
      tool.run(
        { action: "create", content: researchSkillMarkdown },
        memberContext({ automationId: "auto_1" })
      )
    ).rejects.toThrow("not available during automation runs");
  });

  // The whole of SKILL_MANAGE_CHANNELS, so flipping any one value fails here
  // instead of only changing behaviour. The two allowed channels create; the
  // six others are refused before anything touches disk.
  test("lets the skill-management channels through the gate", async () => {
    for (const channel of ["web", "cli"] as const) {
      const { tool } = await setup();

      const result = await tool.run(
        { action: "create", content: researchSkillMarkdown },
        memberContext({ channel })
      );

      expect(result).toMatchObject({ created: true, name: "research-paper" });
      // Each pass needs its own config dir; afterEach only removes the last.
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("refuses every channel outside the skill-management table", async () => {
    const { tool } = await setup();

    for (const channel of [
      "automation",
      "discord",
      "subagent",
      "task",
      "telegram",
      "whatsapp",
    ] as const) {
      await expect(
        tool.run(
          { action: "create", content: researchSkillMarkdown },
          memberContext({ channel })
        )
      ).rejects.toThrow(/interactive web or CLI/);
    }
  });

  test("gate off creates immediately (AE1 regression)", async () => {
    const { db, tool } = await setup();
    await seedOrgProfile(db, { orgSkillsWriteApproval: false });

    const result = await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext()
    );

    expect(result).toMatchObject({
      action: "create",
      assigned: true,
      name: "research-paper",
    });
    expect((result as { staged?: boolean }).staged).toBeUndefined();
  });

  test("gate on stages create without writing disk", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-manage-gate-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgProfile(db, { orgSkillsWriteApproval: true });
    const service = new SkillsService(db);
    const proposalService = new SkillProposalService(db, service);
    const tool = skillManageTool(service, proposalService);
    let invalidations = 0;

    const result = await tool.run(
      { action: "create", content: researchSkillMarkdown },
      memberContext({
        onSkillCatalogChange: () => {
          invalidations += 1;
        },
        profileId: profile.id,
      })
    );

    expect(result).toMatchObject({
      action: "create",
      name: "research-paper",
      outcome: "created",
      staged: true,
    });
    expect(await db.listSkillsForProfile(profile.id)).toHaveLength(0);
    expect(invalidations).toBe(0);
  });

  test("write_file refuses skills/*/SKILL.md when forbidProfileSkillMarkdownWrites is set", async () => {
    await setup();
    const workspaceRoot = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID
    );
    await mkdir(join(workspaceRoot, "skills", "notes"), { recursive: true });

    await expect(
      runWriteFile(
        {
          content: `---
name: notes
description: Notes skill.
---

Body.
`,
          path: "skills/notes/SKILL.md",
        },
        {
          forbidProfileSkillMarkdownWrites: true,
          orgId: ORG_ID,
          profileId: PROFILE_ID,
        },
        { workspaceRoot }
      )
    ).rejects.toThrow(/Use skill_manage/);
  });

  test("edit, write_file, and remove_file manage an assigned skill", async () => {
    const { service, tool } = await setup();

    await tool.run(
      {
        action: "create",
        content: `---
name: deploy
description: Deploy the service.
---

Use staging first.
`,
      },
      memberContext()
    );

    const edited = await tool.run(
      {
        action: "edit",
        content: `---
name: deploy
description: Deploy with canary.
---

Use canary then prod.
`,
        name: "deploy",
      },
      memberContext()
    );
    expect(edited).toMatchObject({
      action: "edit",
      assigned: true,
      name: "deploy",
    });

    const written = await tool.run(
      {
        action: "write_file",
        content: "sidecar\n",
        name: "deploy",
        path: "notes.md",
      },
      memberContext()
    );
    expect(written).toMatchObject({ action: "write_file", path: "notes.md" });

    await expect(
      tool.run(
        {
          action: "write_file",
          content: "nope",
          name: "deploy",
          path: "SKILL.md",
        },
        memberContext()
      )
    ).rejects.toThrow(/patch\/edit/);

    const removed = await tool.run(
      { action: "remove_file", name: "deploy", path: "notes.md" },
      memberContext()
    );
    expect(removed).toMatchObject({ action: "remove_file", path: "notes.md" });

    const detail = await service.getSkill(
      (await service.listSkills()).skills.find(
        (skill) => skill.name === "deploy"
      )!.id
    );
    expect(detail.skill.body).toContain("Use canary then prod.");
  });
});
