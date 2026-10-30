import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChatMessage,
  ensureBundledSkillFiles,
  type GenerateChatInput,
  getProfileSoulDir,
  runReadFile,
  uploadOrganizationKnowledgeBaseDocument,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "../http/test-session-helpers";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { AuthService } from "./auth-service";
import { OrgService } from "./org-service";
import { ProfileService } from "./profile-service";
import { sessionTurnRegistry } from "./session-turn-registry";
import { SkillCuratorService } from "./skill-curator-service";
import { SkillProposalService } from "./skill-proposal-service";
import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

const PROFILE_ID = "profile_default";

const weatherSkillBody = "Call the `weather` tool with a city name.";

const weatherSkillMarkdown = `---
name: weather
description: Get weather forecasts. Use when the user asks about weather.
---

${weatherSkillBody}
`;

describe("SkillsService", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skills-test-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const weatherDir = join(configDir, "agent", "skills", "weather");
    await mkdir(weatherDir, { recursive: true });
    await writeFile(join(weatherDir, "SKILL.md"), weatherSkillMarkdown);
    await writeFile(join(weatherDir, "tool.ts"), "export default {};");
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  async function setupPublishedSkill() {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    for (const id of ["parent", "team_a", "team_b", "other"]) {
      await db.upsertOrganization({
        archivedAt: null,
        createdAt: now,
        id,
        name: id,
        parentOrgId: id.startsWith("team_") ? "parent" : null,
        slug: id,
        updatedAt: now,
      });
      await db.upsertProfile({
        ...createDefaultProfile(),
        id: `profile_${id}`,
        isDefault: false,
        orgId: id,
      });
    }

    const service = new SkillsService(db);

    const skill = (
      await service.createSkill("parent", {
        body: "Published instructions",
        description: "Published notes",
        name: "shared-notes",
        profileId: "profile_parent",
      })
    ).skill;

    const privateSkill = (
      await service.createSkill("parent", {
        body: "Private instructions",
        description: "Private notes",
        name: "private-notes",
        profileId: "profile_parent",
      })
    ).skill;

    const local = (
      await service.createSkill("team_a", {
        description: "Local notes",
        name: "shared-notes",
        profileId: "profile_team_a",
      })
    ).skill;

    const sibling = (
      await service.createSkill("team_b", {
        description: "Private sibling",
        name: "sibling-only",
        profileId: "profile_team_b",
      })
    ).skill;

    const publication = await db.publishOrgSharedResource({
      createdAt: now,
      id: "published_skill",
      orgId: "parent",
      resourceId: skill.id,
      resourceKind: "skill",
      updatedAt: now,
    });

    return { db, local, privateSkill, publication, service, sibling, skill };
  }

  test.each([false, true])(
    "shared agent skill assignments remain live in team execution for cognito=%s",
    async (cognito) => {
      const { db, service, skill, privateSkill } = await setupPublishedSkill();
      await db.unassignSkillFromProfile("profile_parent", skill.id);
      await db.unassignSkillFromProfile("profile_parent", privateSkill.id);
      const now = new Date().toISOString();

      const publication = await db.publishOrgSharedResource({
        createdAt: now,
        id: "published_agent",
        orgId: "parent",
        resourceId: "profile_parent",
        resourceKind: "agent",
        updatedAt: now,
      });

      const instance = await db.createSharedAgentInstance(
        "team_a",
        publication.id,
        "shared_instance",
        now
      );

      await mkdir(getProfileSoulDir("team_a", instance.id), {
        recursive: true,
      });
      await db.createUser({
        createdAt: now,
        email: "shared-agent@example.com",
        id: "shared-user",
        passwordHash: "unused",
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId: "team_a",
        role: "member",
        userId: "shared-user",
      });
      await writeFile(
        join(skill.sourcePath, "tool.js"),
        `import {writeFile} from "node:fs/promises";
export const name = "shared-notes";
export const parameters = {type: "object", properties: {}};
export async function run(input, context) {
  await writeFile("shared.marker", "team");
  return {orgId: context.orgId, profileId: context.profileId, workspace: context.workspaceRoot};
}`
      );
      await db.upsertOrganization({
        ...(await db.getOrganizationById("parent"))!,
        skillsWriteApproval: true,
      });
      const proposals = new SkillProposalService(db, service);

      const staged = await proposals.stageProposal({
        action: "approve_code",
        orgId: "parent",
        profileId: "profile_parent",
        relativePath: "tool.js",
        skillName: "shared-notes",
      });

      await proposals.approveProposal("parent", staged.proposalId!, "admin");
      const turns: GenerateChatInput[] = [];
      const agent = new AgentService(null, null, db);
      agent.setSkillsService(service);
      agent.setOrgService(new OrgService(db, new AuthService()));
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat(input: GenerateChatInput) {
              turns.push(input);

              return Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              });
            },
            name: "test",
          },
        }),
        resolveProfileTools: (profile: { orgId: string; id: string }) =>
          service.loadToolsForProfile(profile.orgId, profile.id),
      });

      const id = await agent.createSession(
        "team_a",
        "web",
        instance.id,
        "shared-user",
        { cognito, orgRole: "member" }
      );

      const first = (await agent.sessions.get(id, "team_a"))!;
      await first.send("First");
      expect(turns[0]!.tools ?? []).toEqual([]);
      await db.assignSkillToProfile("profile_parent", skill.id);
      const second = (await agent.sessions.get(id, "team_a"))!;
      expect(second).not.toBe(first);
      expect(second.getHistory()).toEqual(first.getHistory());
      await second.send("Second");
      expect(turns[1]!.tools?.map((tool) => tool.name)).toContain(
        "shared-notes"
      );

      const tool = (
        await service.loadToolsForProfile("team_a", instance.id)
      )[0]!;

      const context = agent.buildPluginToolContext("team_a", {
        profileId: instance.id,
        runId: "run",
        workflowId: "workflow",
      });

      await mkdir(context.workspaceRoot!, { recursive: true });
      expect(
        await tool.run({}, { ...context, workspaceRoot: skill.sourcePath })
      ).toEqual({
        orgId: "team_a",
        profileId: instance.id,
        workspace: context.workspaceRoot,
      });
      expect(
        await readFile(join(context.workspaceRoot!, "shared.marker"), "utf8")
      ).toBe("team");
      await expect(
        readFile(join(skill.sourcePath, "shared.marker"))
      ).rejects.toThrow();
      expect(
        await service.readPublishedSkillFileForProfile(
          "team_a",
          instance.id,
          "published_skill",
          "SKILL.md",
          10_000
        )
      ).toBeInstanceOf(Uint8Array);
      expect(await db.listSkillsForProfile(instance.id)).toEqual([]);
      const usage = await db.listSkillUsageForProfile(instance.id);

      if (cognito) {
        expect(usage).toEqual([]);
      } else {
        expect(usage).toContainEqual(
          expect.objectContaining({ skillId: skill.id })
        );
      }

      await db.assignSkillToProfile("profile_parent", privateSkill.id);
      await expect(
        service.loadToolsForProfile("team_a", instance.id)
      ).rejects.toMatchObject({ status: 409 });
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 409,
      });
      await db.unassignSkillFromProfile("profile_parent", privateSkill.id);
      await db.unassignSkillFromProfile("profile_parent", skill.id);
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        service.readPublishedSkillFileForProfile(
          "team_a",
          instance.id,
          "published_skill",
          "SKILL.md",
          10_000
        )
      ).rejects.toMatchObject({ status: 404 });
      const third = (await agent.sessions.get(id, "team_a"))!;
      expect(third).not.toBe(second);
      expect(third.getHistory()).toEqual(second.getHistory());
      await third.send("Third");
      expect(turns[2]!.tools ?? []).toEqual([]);
      expect(
        (await agent.getSessionMessages(id, "team_a"))!.messages.filter(
          (message) => message.role === "user"
        )
      ).toHaveLength(3);
      const globalDirectory = join(configDir, "agent", "skills", "weather");
      await writeFile(
        join(globalDirectory, "tool.ts"),
        'export const name = "weather"; export const description = "Weather"; export const parameters = {type: "object", properties: {}}; export async function run() { return "global"; }'
      );
      await db.upsertSkill({
        ...skill,
        id: "global_skill",
        name: "weather",
        orgId: null,
        sourcePath: globalDirectory,
      });
      await db.assignSkillToProfile("profile_parent", "global_skill");
      expect(
        (await service.listSkillsForProfile(instance.id)).map((item) => item.id)
      ).toEqual(["global_skill"]);
      const fourth = (await agent.sessions.get(id, "team_a"))!;
      expect(fourth).not.toBe(third);
      expect(fourth.getHistory()).toEqual(third.getHistory());
      await fourth.send("Fourth");
      expect(turns[3]!.tools?.map((tool) => tool.name)).toContain("weather");
      await db.unassignSkillFromProfile("profile_parent", "global_skill");
      expect(await service.listSkillsForProfile(instance.id)).toEqual([]);
      const fifth = (await agent.sessions.get(id, "team_a"))!;
      expect(fifth).not.toBe(fourth);
      expect(fifth.getHistory()).toEqual(fourth.getHistory());
      await fifth.send("Fifth");
      expect(turns[4]!.tools ?? []).toEqual([]);
      await db.deleteOrgSharedResource("parent", publication.id);
      await expect(
        service.listSkillsForProfile(instance.id)
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.loadToolsForProfile("team_a", instance.id)
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.listSkillsForProfile(instance.id)).toEqual([]);

      if (cognito) {
        expect(await db.getSession(id)).toBeNull();
      }
    }
  );

  test.each(["tool.js", "tool.ts"])(
    "shared JavaScript %s runs current reviewed code in the team",
    async (file) => {
      const { db, skill, publication, service } = await setupPublishedSkill();
      const modulePath = join(skill.sourcePath, file);

      const source = `import { writeFile } from "node:fs/promises";
process.env.NAKAMA_SHARED_JS_CHILD = "child";
export const name = "shared-notes";
export const description = "Probe team context";
export const parameters = {type: "object", properties: {message: {type: "string"}}};
export async function run(input, context) {
  await writeFile("executed.marker", "team");
  return { cwd: process.cwd(), workspace: context.workspaceRoot, orgId: context.orgId, profileId: context.profileId, config: process.env.NAKAMA_CONFIG_DIR ?? null, value: "original", message: input.message };
}
`;

      const originalChild = process.env.NAKAMA_SHARED_JS_CHILD;
      await writeFile(modulePath, source);
      await db.assignSkillToProfile("profile_team_a", skill.id);
      const agent = new AgentService(null, null, db);
      agent.setSkillsService(service);

      const context = agent.buildPluginToolContext("team_a", {
        profileId: "profile_team_a",
        runId: "run",
        workflowId: "workflow",
      });

      const root = context.workspaceRoot!;
      await mkdir(root, { recursive: true });

      const blocked = (
        await service.loadToolsForProfile("team_a", "profile_team_a")
      )[0]!;

      expect(await blocked.run({}, context)).toHaveProperty("error");
      expect(process.env.NAKAMA_SHARED_JS_CHILD).toBe(originalChild);
      await expect(readFile(join(root, "executed.marker"))).rejects.toThrow();
      await db.upsertOrganization({
        ...(await db.getOrganizationById("parent"))!,
        skillsWriteApproval: true,
      });
      const proposals = new SkillProposalService(db, service);

      const approve = async () => {
        const staged = await proposals.stageProposal({
          action: "approve_code",
          orgId: "parent",
          profileId: "profile_parent",
          relativePath: file,
          skillName: "shared-notes",
        });

        await proposals.approveProposal("parent", staged.proposalId!, "admin");
      };

      await approve();

      const tool = (
        await service.loadToolsForProfile("team_a", "profile_team_a")
      )[0]!;

      expect(tool.parameters).toEqual({
        properties: { message: { type: "string" } },
        type: "object",
      });
      expect(process.env.NAKAMA_SHARED_JS_CHILD).toBe(originalChild);
      await expect(readFile(join(root, "executed.marker"))).rejects.toThrow();

      const result = await tool.run(
        { message: "hello" },
        { ...context, workspaceRoot: skill.sourcePath }
      );

      expect(result).toMatchObject({
        config: null,
        message: "hello",
        orgId: "team_a",
        profileId: "profile_team_a",
        value: "original",
        workspace: root,
      });
      // SAFETY: The fixture returns process.cwd(), a string.
      expect(await realpath((result as { cwd: string }).cwd)).toBe(
        await realpath(root)
      );
      expect(process.env.NAKAMA_SHARED_JS_CHILD).toBe(originalChild);
      expect(await readFile(join(root, "executed.marker"), "utf8")).toBe(
        "team"
      );
      await expect(
        readFile(join(skill.sourcePath, "executed.marker"))
      ).rejects.toThrow();
      await writeFile(modulePath, source.replace('"original"', '"updated"'));
      expect(await tool.run({}, context)).toHaveProperty("error");
      await approve();
      expect(await tool.run({}, context)).toMatchObject({ value: "updated" });
      await expect(
        tool.run({}, { ...context, orgRole: undefined })
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        tool.run({}, { ...context, orgId: "team_b" })
      ).rejects.toMatchObject({ status: 404 });

      for (const broken of [
        source + "\n(",
        source.replace(
          "return { cwd:",
          "throw new Error(import.meta.url); return { cwd:"
        ),
      ]) {
        await writeFile(modulePath, broken);
        await approve();

        try {
          await tool.run({}, context);
          throw new Error("Expected failure");
        } catch (error) {
          expect(error).toMatchObject({ status: 503 });
          expect(String(error)).not.toContain(skill.sourcePath);
          expect(String(error)).not.toContain("tool.");
        }
      }

      await db.deleteOrgSharedResource("parent", publication.id);
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 404,
      });
      expect(
        await service.loadToolsForProfile("team_a", "profile_team_a")
      ).toEqual([]);
    }
  );

  test.each(["tool.py", "scripts/probe.py"])(
    "shared Python %s keeps review and team execution checks",
    async (file) => {
      const { db, skill, publication, service } = await setupPublishedSkill();
      const modulePath = join(skill.sourcePath, file);
      await mkdir(join(skill.sourcePath, "scripts"), { recursive: true });

      const source = `"""Report execution context."""
import json
import os
import sys

def run(payload, context):
    with open("executed.marker", "w") as handle:
        handle.write("team")
    return {"cwd": os.getcwd(), "workspace": os.environ.get("NAKAMA_WORKSPACE_ROOT"), "config": os.environ.get("NAKAMA_CONFIG_DIR"), "value": "original"}

if __name__ == "__main__":
    print(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))
`;

      await writeFile(modulePath, source);

      if (file.startsWith("scripts/")) {
        await writeFile(
          join(skill.sourcePath, "SKILL.md"),
          "---\nname: shared-notes\ndescription: Shared Python\nscripts: scripts/probe.py\n---\n\nPublished instructions\n"
        );
      }

      await db.assignSkillToProfile("profile_team_a", skill.id);
      const agent = new AgentService(null, null, db);
      agent.setSkillsService(service);

      const context = agent.buildPluginToolContext("team_a", {
        profileId: "profile_team_a",
        runId: "run",
        workflowId: "workflow",
      });

      const teamRoot = context.workspaceRoot!;
      await mkdir(teamRoot, { recursive: true });

      const expectedName =
        file === "tool.py" ? "shared-notes" : "shared_notes_probe";

      const blocked = (
        await service.loadToolsForProfile("team_a", "profile_team_a")
      ).find((tool) => tool.name === expectedName)!;

      expect(blocked).toBeDefined();
      expect(await blocked.run({}, context)).toHaveProperty("error");
      await expect(
        readFile(join(teamRoot, "executed.marker"))
      ).rejects.toThrow();
      const parent = (await db.getOrganizationById("parent"))!;
      await db.upsertOrganization({ ...parent, skillsWriteApproval: true });
      const proposals = new SkillProposalService(db, service);

      const approve = async () => {
        const staged = await proposals.stageProposal({
          action: "approve_code",
          orgId: "parent",
          profileId: "profile_parent",
          relativePath: file,
          skillName: "shared-notes",
        });

        await proposals.approveProposal("parent", staged.proposalId!, "admin");
      };

      await approve();

      const tool = (
        await service.loadToolsForProfile("team_a", "profile_team_a")
      ).find((entry) => entry.name === expectedName)!;

      const result = await tool.run(
        {},
        { ...context, workspaceRoot: skill.sourcePath }
      );

      expect(result).toMatchObject({
        config: null,
        value: "original",
        workspace: teamRoot,
      });
      // SAFETY: The fixture returns os.getcwd(), a string.
      expect(await realpath((result as { cwd: string }).cwd)).toBe(
        await realpath(teamRoot)
      );
      expect(await readFile(join(teamRoot, "executed.marker"), "utf8")).toBe(
        "team"
      );
      await expect(
        readFile(join(skill.sourcePath, "executed.marker"))
      ).rejects.toThrow();
      expect(
        await service.composeCatalogForProfile("team_a", "profile_team_a")
      ).not.toContain(skill.sourcePath);

      for (const denied of [
        { ...context, orgRole: undefined },
        { ...context, orgId: "team_b" },
        { ...context, profileId: "profile_team_b" },
      ]) {
        await expect(tool.run({}, denied)).rejects.toMatchObject({
          status: denied.orgRole ? 404 : 403,
        });
      }

      await writeFile(modulePath, source.replace('"original"', '"updated"'));
      expect(await tool.run({}, context)).toHaveProperty("error");
      await approve();
      expect(await tool.run({}, context)).toMatchObject({ value: "updated" });
      await db.unassignSkillFromProfile("profile_team_a", skill.id);
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 404,
      });
      await db.assignSkillToProfile("profile_team_a", skill.id);
      await db.deleteOrgSharedResource("parent", publication.id);
      await expect(tool.run({}, context)).rejects.toMatchObject({
        status: 404,
      });
      expect(
        (await service.loadToolsForProfile("team_a", "profile_team_a")).map(
          (entry) => entry.name
        )
      ).not.toContain(expectedName);
      expect(
        (await db.listSkillsForProfile("profile_team_a")).map(
          (entry) => entry.id
        )
      ).toEqual([skill.id]);
      expect(await readFile(modulePath, "utf8")).toBe(
        source.replace('"original"', '"updated"')
      );
    }
  );

  test("published assignments keep source references and remove revoked summaries", async () => {
    const { db, skill, publication, service } = await setupPublishedSkill();
    const profiles = new ProfileService(db);

    const assigned = await profiles.assignSkill("team_a", "profile_team_a", {
      skillId: skill.id,
    });

    expect(assigned.profile.skills).toEqual([]);
    expect(assigned.profile.publishedSkills).toMatchObject([
      { id: skill.id, publicationId: publication.id, scope: "parent" },
    ]);
    expect(JSON.stringify(assigned)).not.toContain(skill.sourcePath);
    await profiles.assignSkill("team_a", "profile_team_a", {
      skillId: skill.id,
    });
    expect(
      (await db.listSkillsForProfile("profile_team_a")).map((item) => item.id)
    ).toEqual([skill.id]);
    expect(
      await service.listSkillSummariesForProfile("team_a", "profile_team_a")
    ).toEqual([]);
    expect(await service.listSkillsForProfile("profile_team_a")).toEqual([]);
    expect(
      await service.composeCatalogForProfile("team_a", "profile_team_a")
    ).toContain("published-skill://published_skill/SKILL.md");
    expect(
      (await db.listSkillsForProfile("profile_team_a")).map((item) => item.id)
    ).toEqual([skill.id]);
    await expect(
      service.listSkillSummariesForProfile("team_b", "profile_team_a")
    ).rejects.toMatchObject({ status: 404 });
    await db.deleteOrgSharedResource("parent", publication.id);
    expect(
      (await profiles.getProfile("team_a", "profile_team_a")).profile
        .publishedSkills
    ).toEqual([]);
    expect(await db.listSkillsForProfile("profile_team_a")).toHaveLength(1);
    await profiles.unassignSkill("team_a", "profile_team_a", skill.id);
    expect(await db.listSkillsForProfile("profile_team_a")).toEqual([]);
    expect(await db.getSkill(skill.id)).not.toBeNull();
    expect(
      await readFile(join(skill.sourcePath, "SKILL.md"), "utf8")
    ).toContain("Published instructions");
  });

  test.each(["parent-first", "local-first"] as const)(
    "same-name assignments fail without changing references: %s",
    async (order) => {
      const { db, local, skill } = await setupPublishedSkill();
      const profiles = new ProfileService(db);

      const [first, second] =
        order === "parent-first" ? [skill, local] : [local, skill];

      await profiles.assignSkill("team_a", "profile_team_a", {
        skillId: first.id,
      });
      await expect(
        profiles.assignSkill("team_a", "profile_team_a", { skillId: second.id })
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await db.listSkillsForProfile("profile_team_a")).map((item) => item.id)
      ).toEqual([first.id]);
    }
  );

  test("prompt discovery matches parent instructions without exposing source paths", async () => {
    const { db, service, skill, local, privateSkill, sibling } =
      await setupPublishedSkill();

    await db.assignSkillToProfile("profile_team_a", skill.id);

    const catalog = await service.composeCatalogForProfile(
      "team_a",
      "profile_team_a"
    );

    expect(catalog).toContain("published-skill://published_skill/SKILL.md");

    for (const source of [skill, local, privateSkill, sibling]) {
      expect(catalog).not.toContain(source.sourcePath);
    }

    const explicit = await service.formatMatchedSkillsForPrompt(
      "team_a",
      "profile_team_a",
      "/skill shared-notes"
    );

    expect(explicit).toContain("Published instructions");
    expect(explicit).not.toContain(skill.sourcePath);
    expect(explicit).toContain('"parent"');
    await db.assignSkillToProfile("profile_team_a", local.id);
    await expect(
      service.composeCatalogForProfile("team_a", "profile_team_a")
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.formatMatchedSkillsForPrompt(
        "team_a",
        "profile_team_a",
        "/skill shared-notes"
      )
    ).rejects.toMatchObject({ status: 409 });
  });

  test("agent file contexts check assignments and publications on every read", async () => {
    const { db, service, skill, publication } = await setupPublishedSkill();
    await mkdir(join(skill.sourcePath, "references"));
    await writeFile(
      join(skill.sourcePath, "references", "guide.md"),
      "First\nSecond\nThird"
    );
    const agent = new AgentService(null, null, db);
    agent.setSkillsService(service);

    const context = agent.buildPluginToolContext("team_a", {
      profileId: "profile_team_a",
      runId: "run",
      workflowId: "workflow",
    });

    const instruction = { path: "published-skill://published_skill/SKILL.md" };
    await expect(runReadFile(instruction, context)).rejects.toMatchObject({
      status: 404,
    });
    await db.assignSkillToProfile("profile_team_a", skill.id);
    expect((await runReadFile(instruction, context)).content).toContain(
      "Published instructions"
    );

    const reference = await runReadFile(
      {
        limit: 1,
        offset: 2,
        path: "published-skill://published_skill/references/guide.md",
      },
      context
    );

    expect(reference).toMatchObject({
      content: "Second",
      endLine: 2,
      path: "published-skill://published_skill/references/guide.md",
      startLine: 2,
      totalLines: 3,
      truncated: true,
    });
    expect(JSON.stringify(reference)).not.toContain(skill.sourcePath);
    await expect(
      runReadFile({ path: skill.sourcePath + "/SKILL.md" }, context)
    ).rejects.toThrow();
    const large = Buffer.alloc(1024 * 1024 + 1, 65);
    await writeFile(join(skill.sourcePath, "large.txt"), large);
    expect(
      (
        await runReadFile(
          { path: "published-skill://published_skill/large.txt" },
          context
        )
      ).bytesRead
    ).toBe(large.length);
    expect(
      (
        await service.readPublishedSkillFile(
          "team_a",
          publication.id,
          "large.txt"
        )
      ).content
    ).toBeNull();
    await expect(
      service.readPublishedSkillFileForProfile(
        "team_a",
        "profile_team_a",
        publication.id,
        "large.txt",
        100
      )
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      service.readPublishedSkillFileForProfile(
        "team_a",
        "profile_team_a",
        publication.id,
        "SKILL.md",
        Number.POSITIVE_INFINITY
      )
    ).rejects.toMatchObject({ status: 400 });

    for (const file of ["../SKILL.md", "/etc/passwd", "a\\b", "a\0b"]) {
      await expect(
        runReadFile(
          {
            path: `published-skill://published_skill/${encodeURIComponent(file)}`,
          },
          context
        )
      ).rejects.toMatchObject({ status: 400 });
    }

    await symlink(
      join(skill.sourcePath, "..", "private-notes", "SKILL.md"),
      join(skill.sourcePath, "outside.md")
    );
    await expect(
      runReadFile(
        { path: "published-skill://published_skill/outside.md" },
        context
      )
    ).rejects.toMatchObject({ status: 403 });

    const word = await readFile(
      new URL(
        "../../../../packages/core/src/__fixtures__/sample.docx",
        import.meta.url
      )
    );

    await writeFile(join(skill.sourcePath, "report.docx"), word);
    expect(
      (
        await runReadFile(
          { path: "published-skill://published_skill/report.docx" },
          context
        )
      ).content
    ).toContain("Laporan Mingguan");

    const siblingContext = agent.buildPluginToolContext("team_b", {
      profileId: "profile_team_b",
      runId: "run",
      workflowId: "workflow",
    });

    await expect(
      runReadFile(instruction, siblingContext)
    ).rejects.toMatchObject({ status: 404 });
    await db.unassignSkillFromProfile("profile_team_a", skill.id);
    await expect(runReadFile(instruction, context)).rejects.toMatchObject({
      status: 404,
    });
    await db.assignSkillToProfile("profile_team_a", skill.id);
    await db.deleteOrgSharedResource("parent", publication.id);
    await expect(runReadFile(instruction, context)).rejects.toMatchObject({
      status: 404,
    });
  });

  test.each([false, true])(
    "cached shared tools refresh with history for cognito=%s",
    async (cognito) => {
      const { db, service, skill, publication } = await setupPublishedSkill();
      const now = new Date().toISOString();
      await db.createUser({
        createdAt: now,
        email: "shared@example.com",
        id: "shared-user",
        passwordHash: "unused",
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId: "team_a",
        role: "member",
        userId: "shared-user",
      });
      const userContext = "User context to preserve";
      await db.setUserContext("team_a", "shared-user", userContext, now);
      await writeFile(
        join(skill.sourcePath, "tool.js"),
        'export const name = "shared-notes"; export const parameters = {type: "object", properties: {old: {type: "string"}}}; export async function run() { return "done"; }'
      );
      await db.upsertOrganization({
        ...(await db.getOrganizationById("parent"))!,
        skillsWriteApproval: true,
      });
      const proposals = new SkillProposalService(db, service);

      const approve = async () => {
        const staged = await proposals.stageProposal({
          action: "approve_code",
          orgId: "parent",
          profileId: "profile_parent",
          relativePath: "tool.js",
          skillName: "shared-notes",
        });

        await proposals.approveProposal("parent", staged.proposalId!, "admin");
      };

      await approve();
      const turns: GenerateChatInput[] = [];
      let failBuild = false;
      const agent = new AgentService(null, null, db);
      agent.setSkillsService(service);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat(input: GenerateChatInput) {
              turns.push(input);

              return Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              });
            },
            name: "test",
          },
        }),
        resolveProfileTools: async (profile: { orgId: string; id: string }) => {
          if (failBuild) {
            throw new Error("Build failed");
          }

          return service.loadToolsForProfile(profile.orgId, profile.id);
        },
      });

      const id = await agent.createSession(
        "team_a",
        "web",
        "profile_team_a",
        "shared-user",
        { cognito, orgRole: "member" }
      );

      const first = (await agent.sessions.get(id, "team_a"))!;
      await first.send("First");
      expect(turns[0]!.tools?.map((tool) => tool.name) ?? []).not.toContain(
        "shared-notes"
      );

      const todos = await agent["agentTodoState"].write(id, {
        merge: false,
        todos: [{ content: "Keep task", id: "todo", status: "pending" }],
      });

      const questionnaire = await agent["agentQuestionnaireState"].write(id, {
        id: "questionnaire",
        questions: [
          {
            allowCustomAnswer: false,
            choices: [{ id: "choice", label: "One" }],
            id: "question",
            prompt: "Choose",
          },
        ],
        title: "Choice",
      });

      await db.assignSkillToProfile("profile_team_a", skill.id);
      failBuild = true;
      await expect(agent.sessions.get(id, "team_a")).rejects.toThrow();
      expect(
        first.getHistory().filter((message) => message.role === "user")
      ).toHaveLength(1);
      expect(await agent.getSessionTodos(id, "team_a")).toEqual(todos);
      expect(await agent.getSessionQuestionnaire(id, "team_a")).toEqual(
        questionnaire
      );
      failBuild = false;
      expect(await agent.beginSessionTurn(id, "team_a")).toBe(true);
      const second = (await agent.sessions.get(id, "team_a"))!;
      expect(second).not.toBe(first);
      expect(second.getHistory()).toEqual(first.getHistory());
      expect(await agent.getSessionQuestionnaire(id, "team_a")).toEqual(
        questionnaire
      );
      sessionTurnRegistry.cancelTurn(id);
      await second.send("Second");
      expect(turns[1]!.tools?.map((tool) => tool.name)).toContain(
        "shared-notes"
      );
      expect(turns[1]!.system).toContain(userContext);
      await writeFile(
        join(skill.sourcePath, "tool.js"),
        'export const name = "shared-notes"; export const parameters = {type: "object", properties: {current: {type: "number"}}}; export async function run() { return "done"; }'
      );
      await approve();
      const updated = (await agent.sessions.get(id, "team_a"))!;
      expect(updated).not.toBe(second);
      await updated.send("Third");
      // A turn can also trigger follow-up provider calls; the newest one has
      // the rebuilt session's tools.
      expect(
        turns.at(-1)!.tools?.find((tool) => tool.name === "shared-notes")
          ?.parameters
      ).toMatchObject({ properties: { current: { type: "number" } } });
      await db.deleteOrgSharedResource("parent", publication.id);
      const revoked = (await agent.sessions.get(id, "team_a"))!;
      expect(revoked).not.toBe(updated);
      await revoked.send("Fourth");
      expect(turns.at(-1)!.tools?.map((tool) => tool.name) ?? []).not.toContain(
        "shared-notes"
      );
      expect(
        revoked.getHistory().filter((message) => message.role === "user")
      ).toHaveLength(4);
      expect((await agent.getSessionMessages(id, "team_a"))?.profileId).toBe(
        "profile_team_a"
      );

      if (cognito) {
        expect(await db.getSession(id)).toBeNull();
        expect(await db.listMessagesForSession(id)).toEqual([]);
      } else {
        expect(
          (await db.listMessagesForSession(id)).filter(
            // SAFETY: Real session writes store ChatMessage payloads on this tested path.
            (message) => (message.payload as ChatMessage).role === "user"
          )
        ).toHaveLength(4);
      }
    }
  );

  test.each([false, true])(
    "cached skill catalogs recheck publications for cognito=%s",
    async (cognito) => {
      const { db, service, skill, publication } = await setupPublishedSkill();
      await db.assignSkillToProfile("profile_team_a", skill.id);
      const prompts: string[] = [];
      const agent = new AgentService(null, null, db);
      agent.setSkillsService(service);
      Object.assign(agent, {
        _providerConfigured: true,
        createHarnessForProfile: () => ({
          provider: {
            generateChat(input: GenerateChatInput) {
              prompts.push(input.system ?? "");

              return Promise.resolve({
                assistantMessage: { content: "Done", role: "assistant" },
                content: "Done",
                toolCalls: [],
              });
            },
            name: "test",
          },
        }),
        resolveProfileTools: async () => [],
      });

      const id = await agent.createSession(
        "team_a",
        "web",
        "profile_team_a",
        null,
        { cognito, orgRole: "member" }
      );

      const session = await agent.sessions.get(id, "team_a");
      expect(session).not.toBeNull();
      await session!.send("First question");
      expect(prompts[0]).toContain(
        "published-skill://published_skill/SKILL.md"
      );
      expect(prompts[0]).not.toContain(skill.sourcePath);
      expect(prompts[0]).not.toContain("Published instructions");
      await db.deleteOrgSharedResource("parent", publication.id);
      await session!.send("Second question");
      expect(prompts[1]).not.toContain("published-skill://published_skill");
      await db.upsertOrganization({
        ...(await db.getOrganizationById("parent"))!,
        name: "Renamed parent",
      });
      await writeFile(
        join(skill.sourcePath, "SKILL.md"),
        "---\nname: shared-notes\ndescription: Current source description\n---\n\nCurrent instructions\n"
      );
      await db.publishOrgSharedResource(publication);
      await session!.send("/skill shared-notes");
      expect(prompts[2]).toContain("Renamed parent");
      expect(prompts[2]).toContain("Current instructions");
      expect(prompts[2]).not.toContain("Published instructions");
      expect(await agent.sessions.get(id, "team_a")).toBe(session);
      expect(
        session!.getHistory().filter((message) => message.role === "user")
      ).toHaveLength(3);
    }
  );

  test("private, sibling, and revoked sources cannot create team assignments", async () => {
    const { db, privateSkill, sibling, skill, publication } =
      await setupPublishedSkill();

    const profiles = new ProfileService(db);
    await db.deleteOrgSharedResource("parent", publication.id);

    for (const source of [privateSkill, sibling, skill]) {
      await expect(
        profiles.assignSkill("team_a", "profile_team_a", { skillId: source.id })
      ).rejects.toMatchObject({ status: 404 });
    }

    expect(await db.listSkillsForProfile("profile_team_a")).toEqual([]);
  });

  test("team maintenance omits parent sources before archive and consolidation", async () => {
    const { db, skill, service, publication } = await setupPublishedSkill();
    await db.assignSkillToProfile("profile_team_a", skill.id);
    await db.upsertSkill({
      ...(await db.getSkill(skill.id))!,
      createdAt: "2020-01-01T00:00:00.000Z",
      createdBy: "agent",
    });
    await db.upsertOrganization({
      ...(await db.getOrganizationById("team_a"))!,
      skillsCuratorConsolidateEnabled: true,
    });
    const original = await readFile(join(skill.sourcePath, "SKILL.md"), "utf8");

    const result = await new SkillCuratorService(db, service).run("team_a", {
      now: new Date("2026-10-11T00:00:00.000Z"),
      trigger: "manual",
    });

    expect(result.scanned).toBe(0);
    expect(await readFile(join(skill.sourcePath, "SKILL.md"), "utf8")).toBe(
      original
    );
    expect(await db.listSkillsForProfile("profile_team_a")).toHaveLength(1);
    expect(
      await db.getOrgSharedResource("parent", publication.id)
    ).not.toBeNull();
    expect(
      await db.listSkillProposals("team_a", { profileId: "profile_team_a" })
    ).toEqual([]);
  });

  test.each(["admin", "member"] as const)(
    "%s can change skill assignments only with the team admin role",
    async (role) => {
      const { db, skill, privateSkill } = await setupPublishedSkill();
      const profiles = new ProfileService(db);

      const { app, authService } = createMinimalHonoApp({
        agent: {
          assignSkill: profiles.assignSkill.bind(profiles),
          getProfile: profiles.getProfile.bind(profiles),
          unassignSkill: profiles.unassignSkill.bind(profiles),
        },
        databaseAdapter: db,
      });

      const now = new Date().toISOString();
      await db.createUser({
        createdAt: now,
        email: "skill-admin@example.com",
        id: "team-admin",
        passwordHash: await authService.hashPassword("password123"),
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId: "team_a",
        role,
        userId: "team-admin",
      });

      const session = await loginUserSession(
        app,
        "skill-admin@example.com",
        "password123"
      );

      const assign = (skillId: string, profileId = "profile_team_a") =>
        app.fetch(
          new Request(`http://localhost:4310/v1/profiles/${profileId}/skills`, {
            body: JSON.stringify({ skillId }),
            headers: session.headers(
              {
                "content-type": "application/json",
                "X-CSRF-Token": session.csrfToken,
              },
              "team_a"
            ),
            method: "POST",
          })
        );

      const response = await assign(skill.id);
      expect(response.status).toBe(role === "admin" ? 200 : 403);

      if (role === "admin") {
        expect((await response.json()).profile.publishedSkills[0].id).toBe(
          skill.id
        );
        expect((await assign(privateSkill.id)).status).toBe(404);
        expect((await assign(skill.id, "profile_team_b")).status).toBe(404);
      }

      const removed = await app.fetch(
        new Request(
          `http://localhost:4310/v1/profiles/profile_team_a/skills/${skill.id}`,
          {
            headers: session.headers(
              { "X-CSRF-Token": session.csrfToken },
              "team_a"
            ),
            method: "DELETE",
          }
        )
      );

      expect(removed.status).toBe(role === "admin" ? 200 : 403);
      expect(await db.listSkillsForProfile("profile_team_a")).toEqual([]);
    }
  );

  test("team catalogs separate parent publications and preserve local and global skills", async () => {
    const { service, skill, privateSkill, local, sibling } =
      await setupPublishedSkill();

    const a = await service.listSkills("team_a");
    const b = await service.listSkills("team_b");
    expect(a.publishedSkills).toEqual(b.publishedSkills);
    expect(a.publishedSkills).toHaveLength(1);
    expect(a.publishedSkills?.[0]).toMatchObject({
      id: skill.id,
      publicationId: "published_skill",
      scope: "parent",
      sourceOrganization: { id: "parent", name: "parent" },
    });
    expect(JSON.stringify(a.publishedSkills)).not.toContain(skill.sourcePath);
    expect(a.publishedSkills?.[0]).not.toHaveProperty("sourcePath");
    expect(JSON.stringify(a.publishedSkills)).not.toContain(
      "Published instructions"
    );
    expect(a.skills.some((item) => item.id === local.id)).toBe(true);
    expect(a.skills.some((item) => item.name === "weather")).toBe(true);
    expect(
      a.skills.some((item) =>
        [skill.id, privateSkill.id, sibling.id].includes(item.id)
      )
    ).toBe(false);
    expect((await service.listSkills("other")).publishedSkills).toEqual([]);
    expect((await service.listSkills("parent")).publishedSkills).toEqual([]);
  });

  test("published file previews stay within the source skill and preserve preview limits", async () => {
    const { service, skill, publication, privateSkill } =
      await setupPublishedSkill();

    await mkdir(join(skill.sourcePath, "references"));
    await writeFile(
      join(skill.sourcePath, "references", "guide.md"),
      "Shared reference"
    );
    await writeFile(
      join(skill.sourcePath, "binary.bin"),
      Buffer.from([0, 1, 2])
    );
    await writeFile(
      join(skill.sourcePath, "large.txt"),
      Buffer.alloc(1024 * 1024 + 1, 65)
    );
    const image = Buffer.from([137, 80, 78, 71]);
    await writeFile(join(skill.sourcePath, "image.png"), image);
    await symlink(
      join(privateSkill.sourcePath, "SKILL.md"),
      join(skill.sourcePath, "secret.md")
    );
    await symlink(privateSkill.sourcePath, join(skill.sourcePath, "private"));

    const listing = await service.listPublishedSkillFiles(
      "team_a",
      publication.id
    );

    expect(listing.files).toContainEqual({
      path: "references/guide.md",
      type: "file",
    });
    expect(
      listing.files.some(
        (file) => file.path.startsWith("private") || file.path === "secret.md"
      )
    ).toBe(false);
    expect(JSON.stringify(listing)).not.toContain(skill.sourcePath);
    expect(
      await service.readPublishedSkillFile(
        "team_a",
        publication.id,
        "references/guide.md"
      )
    ).toEqual({ content: "Shared reference", path: "references/guide.md" });
    expect(
      (
        await service.readPublishedSkillFile(
          "team_a",
          publication.id,
          "image.png"
        )
      ).image
    ).toEqual({ dataBase64: image.toString("base64"), mediaType: "image/png" });

    for (const file of ["binary.bin", "large.txt"]) {
      const result = await service.readPublishedSkillFile(
        "team_a",
        publication.id,
        file
      );

      expect(result.content).toBeNull();
      expect(result.unavailableReason).toBeDefined();
    }

    for (const file of [
      "../private-notes/SKILL.md",
      "/tmp/secret.md",
      "references\\guide.md",
      "bad\0.md",
      "",
    ]) {
      await expect(
        service.readPublishedSkillFile("team_a", publication.id, file)
      ).rejects.toMatchObject({ status: 400 });
    }

    for (const file of ["secret.md", "private/SKILL.md"]) {
      await expect(
        service.readPublishedSkillFile("team_a", publication.id, file)
      ).rejects.toMatchObject({ status: 403 });
    }

    await expect(
      service.readPublishedSkillFile("team_a", publication.id, "missing.md")
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.readPublishedSkillFile("team_a", publication.id, "references")
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await readFile(join(privateSkill.sourcePath, "SKILL.md"), "utf8")
    ).toContain("Private instructions");
  });

  test.each([
    "revoke",
    "disabled",
    "missing",
    "file-symlink",
    "team-archive",
    "parent-archive",
  ] as const)(
    "parent catalog removes unavailable entries after %s",
    async (change) => {
      const { db, service, skill, publication } = await setupPublishedSkill();
      expect((await service.listSkills("team_a")).publishedSkills).toHaveLength(
        1
      );

      if (change === "revoke") {
        await db.deleteOrgSharedResource("parent", publication.id);
      } else if (change === "disabled") {
        await db.upsertSkill({
          ...(await db.getSkill(skill.id))!,
          enabled: false,
        });
      } else if (change === "missing" || change === "file-symlink") {
        await rm(join(skill.sourcePath, "SKILL.md"));

        if (change === "file-symlink") {
          const secret = join(configDir, "secret.md");
          await writeFile(secret, "Private bytes");
          await symlink(secret, join(skill.sourcePath, "SKILL.md"));
        }
      } else {
        const id = change === "team-archive" ? "team_a" : "parent";

        if (change === "parent-archive") {
          for (const childId of ["team_a", "team_b"]) {
            await db.upsertOrganization({
              ...(await db.getOrganizationById(childId))!,
              archivedAt: new Date().toISOString(),
            });
          }
        }

        await db.upsertOrganization({
          ...(await db.getOrganizationById(id))!,
          archivedAt: new Date().toISOString(),
        });
      }

      expect((await service.listSkills("team_a")).publishedSkills).toEqual([]);
      await expect(
        service.getPublishedSkill("team_a", publication.id)
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.listPublishedSkillFiles("team_a", publication.id)
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.readPublishedSkillFile("team_a", publication.id, "SKILL.md")
      ).rejects.toMatchObject({ status: 404 });
    }
  );

  test("parent catalog reads current metadata and preserves database failures", async () => {
    const { db, service, skill } = await setupPublishedSkill();
    await writeFile(
      join(skill.sourcePath, "SKILL.md"),
      "---\nname: shared-notes\ndescription: Updated source\n---\n\nUpdated body\n"
    );
    expect(
      (await service.listSkills("team_a")).publishedSkills?.[0]?.description
    ).toBe("Updated source");

    const read = spyOn(db, "listOrgSharedResources").mockRejectedValueOnce(
      new Error("database unavailable")
    );

    try {
      await expect(service.listSkills("team_a")).rejects.toThrow();
    } finally {
      read.mockRestore();
    }

    const failure = new Error("database unavailable");
    const publicationRead = spyOn(db, "getOrgSharedResource");

    try {
      publicationRead.mockRejectedValueOnce(failure);
      await expect(
        service.listPublishedSkillFiles("team_a", "published_skill")
      ).rejects.toBe(failure);
      publicationRead.mockRejectedValueOnce(failure);
      await expect(
        service.readPublishedSkillFile("team_a", "published_skill", "SKILL.md")
      ).rejects.toBe(failure);
    } finally {
      publicationRead.mockRestore();
    }
  });

  test("parent catalog accepts a source alias within its guarded source tenant", async () => {
    const { db, service, skill } = await setupPublishedSkill();
    const alias = join(configDir, "published-source-alias");
    await symlink(skill.sourcePath, alias);
    await db.upsertSkill({
      ...(await db.getSkill(skill.id))!,
      sourcePath: alias,
    });
    const catalog = await service.listSkills("team_a");
    expect(catalog.publishedSkills?.[0]?.id).toBe(skill.id);
    expect(JSON.stringify(catalog.publishedSkills)).not.toContain(alias);
  });

  test.each(["member"] as const)(
    "%s reads shared skill content through either sibling without parent membership",
    async (role) => {
      const { db, service, skill, privateSkill, publication } =
        await setupPublishedSkill();

      await mkdir(join(skill.sourcePath, "references"));
      await writeFile(
        join(skill.sourcePath, "references", "guide.md"),
        "Shared reference"
      );

      const { app, authService } = createMinimalHonoApp({
        agent: {
          getPublishedSkill: (orgId: string, publicationId: string) =>
            service.getPublishedSkill(orgId, publicationId),
          getSkill: (id: string, orgId?: string) => service.getSkill(id, orgId),
          listPublishedSkillFiles:
            service.listPublishedSkillFiles.bind(service),
          readPublishedSkillFile: service.readPublishedSkillFile.bind(service),
        },
        databaseAdapter: db,
      });

      const now = new Date().toISOString();
      await db.createUser({
        createdAt: now,
        email: "skill-reader@example.com",
        id: "reader",
        passwordHash: await authService.hashPassword("password123"),
        updatedAt: now,
      });

      for (const orgId of ["team_a", "team_b", "other"]) {
        await db.upsertOrgMember({
          createdAt: now,
          orgId,
          role,
          userId: "reader",
        });
      }

      const session = await loginUserSession(
        app,
        "skill-reader@example.com",
        "password123"
      );

      const read = (
        orgId = "team_a",
        id = publication.id,
        activeOrg = orgId,
        suffix = ""
      ) =>
        app.fetch(
          new Request(
            `http://localhost:4310/v1/orgs/${orgId}/shared-resources/${id}/skill${suffix}`,
            { headers: session.headers({}, activeOrg) }
          )
        );

      for (const orgId of ["team_a", "team_b"]) {
        const response = await read(orgId);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.skill).toMatchObject({
          id: skill.id,
          publicationId: publication.id,
          sourceOrganization: { id: "parent", name: "parent" },
        });
        expect(body.skill.body).toContain("Published instructions");
        expect(body.skill).not.toHaveProperty("sourcePath");
        expect(body.skill).not.toHaveProperty("usage");
        expect(JSON.stringify(body)).not.toContain(skill.sourcePath);
        const files = await read(orgId, publication.id, orgId, "/files");
        expect(files.status).toBe(200);
        const listed = await files.json();
        expect(listed.files).toContainEqual({
          path: "references/guide.md",
          type: "file",
        });
        expect(JSON.stringify(listed)).not.toContain(skill.sourcePath);

        const file = await read(
          orgId,
          publication.id,
          orgId,
          "/file?path=references%2Fguide.md"
        );

        expect(file.status).toBe(200);
        expect(await file.json()).toEqual({
          content: "Shared reference",
          path: "references/guide.md",
        });
      }

      expect(await db.getOrgMember("parent", "reader")).toBeNull();

      const foreignSkill = await service.createSkill("other", {
        description: "Foreign source",
        name: "foreign-notes",
        profileId: "profile_other",
      });

      const knowledge = await uploadOrganizationKnowledgeBaseDocument(
        "parent",
        {
          data: Buffer.from("Published knowledge").toString("base64"),
          filename: "shared.txt",
          mediaType: "text/plain",
        }
      );

      for (const [id, orgId, resourceKind, resourceId] of [
        ["wrong-kind", "parent", "knowledge", knowledge.document.id],
        ["foreign-publication", "other", "skill", foreignSkill.skill.id],
      ] as const) {
        await db.publishOrgSharedResource({
          createdAt: now,
          id,
          orgId,
          resourceId,
          resourceKind,
          updatedAt: now,
        });
      }

      for (const id of [
        skill.id,
        privateSkill.id,
        "missing-publication",
        "wrong-kind",
        "foreign-publication",
      ]) {
        expect((await read("team_a", id)).status).toBe(404);

        for (const suffix of ["/files", "/file?path=SKILL.md"]) {
          expect((await read("team_a", id, "team_a", suffix)).status).toBe(404);
        }
      }

      for (const suffix of ["/files", "/file?path=SKILL.md"]) {
        expect(
          (await read("other", publication.id, "other", suffix)).status
        ).toBe(404);
        expect(
          (await read("team_b", publication.id, "team_a", suffix)).status
        ).toBe(404);
        expect(
          (await read("parent", publication.id, "parent", suffix)).status
        ).toBe(404);
        expect(
          (
            await app.fetch(
              new Request(
                `http://localhost:4310/v1/orgs/team_a/shared-resources/${publication.id}/skill${suffix}`
              )
            )
          ).status
        ).toBe(401);
      }

      expect((await read("other")).status).toBe(404);
      expect((await read("team_b", publication.id, "team_a")).status).toBe(404);
      const deniedParent = await read("parent");
      expect(deniedParent.status).toBe(404);
      expect(await deniedParent.text()).not.toContain("Published instructions");

      const anonymous = await app.fetch(
        new Request(
          `http://localhost:4310/v1/orgs/team_a/shared-resources/${publication.id}/skill`
        )
      );

      expect(anonymous.status).toBe(401);
      const updatedBody = "New shared instructions";
      await writeFile(
        join(skill.sourcePath, "SKILL.md"),
        `---\nname: shared-notes\ndescription: Updated\n---\n\n${updatedBody}\n`
      );
      expect((await (await read()).json()).skill.body).toContain(updatedBody);
      await writeFile(
        join(skill.sourcePath, "references", "guide.md"),
        "Updated shared reference"
      );
      expect(
        (
          await (
            await read(
              "team_a",
              publication.id,
              "team_a",
              "/file?path=references%2Fguide.md"
            )
          ).json()
        ).content
      ).toBe("Updated shared reference");
      await db.deleteOrgSharedResource("parent", publication.id);
      expect((await read()).status).toBe(404);
      expect(
        (await read("team_a", publication.id, "team_a", "/files")).status
      ).toBe(404);
      expect(
        (
          await read(
            "team_a",
            publication.id,
            "team_a",
            "/file?path=references%2Fguide.md"
          )
        ).status
      ).toBe(404);

      const spec = await (
        await app.fetch(new Request("http://localhost:4310/openapi.json"))
      ).json();

      expect(
        spec.paths["/v1/orgs/{orgId}/shared-resources/{publicationId}/skill"]
          .get
      ).toBeDefined();
      expect(
        spec.components.schemas.PublishedSkillResponse.properties.skill
          .properties.body.type
      ).toBe("string");
      expect(
        spec.paths[
          "/v1/orgs/{orgId}/shared-resources/{publicationId}/skill/files"
        ].get
      ).toBeDefined();
      expect(
        spec.paths[
          "/v1/orgs/{orgId}/shared-resources/{publicationId}/skill/file"
        ].get
      ).toBeDefined();
      expect(
        spec.components.schemas.SkillFilesResponse.properties.files.type
      ).toBe("array");
      expect(
        spec.components.schemas.SkillFileResponse.properties.path.type
      ).toBe("string");
    }
  );

  test("root admins read published skill details and assets without source write access", async () => {
    const { db, service, skill, privateSkill, local, sibling, publication } =
      await setupPublishedSkill();

    await mkdir(join(skill.sourcePath, "references"));
    await writeFile(
      join(skill.sourcePath, "references", "guide.md"),
      "Root reference"
    );

    const { app, authService } = createMinimalHonoApp({
      agent: {
        getPublishedSkill: service.getPublishedSkill.bind(service),
        listPublishedSkillFiles: service.listPublishedSkillFiles.bind(service),
        readPublishedSkillFile: service.readPublishedSkillFile.bind(service),
      },
      databaseAdapter: db,
    });

    const now = new Date().toISOString();
    await db.createUser({
      createdAt: now,
      email: "root-skill-reader@example.com",
      id: "root-reader",
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });

    for (const orgId of ["parent", "team_a"]) {
      await db.upsertOrgMember({
        createdAt: now,
        orgId,
        role: "admin",
        userId: "root-reader",
      });
    }

    const session = await loginUserSession(
      app,
      "root-skill-reader@example.com",
      "password123"
    );

    const read = (id = publication.id, suffix = "", activeOrg = "parent") =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/orgs/parent/shared-resources/${id}/skill${suffix}`,
          { headers: session.headers({}, activeOrg) }
        )
      );

    const detail = await read();
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.skill).toMatchObject({
      id: skill.id,
      publicationId: publication.id,
      sourceOrganization: { id: "parent", name: "parent" },
    });
    expect(body.skill.body).toContain("Published instructions");
    expect(body.skill).not.toHaveProperty("sourcePath");
    expect(body.skill).not.toHaveProperty("usage");
    expect(JSON.stringify(body)).not.toContain(skill.sourcePath);
    const files = await read(publication.id, "/files");
    expect(files.status).toBe(200);
    expect((await files.json()).files).toContainEqual({
      path: "references/guide.md",
      type: "file",
    });
    const file = await read(publication.id, "/file?path=references%2Fguide.md");
    expect(file.status).toBe(200);
    expect(await file.json()).toEqual({
      content: "Root reference",
      path: "references/guide.md",
    });

    const suffixes = ["", "/files", "/file?path=SKILL.md"];

    const foreign = await service.createSkill("other", {
      description: "Foreign root source",
      name: "foreign-root-notes",
      profileId: "profile_other",
    });

    for (const [id, orgId, resourceKind, resourceId] of [
      ["foreign-publication", "other", "skill", foreign.skill.id],
      ["root-wrong-kind", "parent", "agent", "profile_parent"],
    ] as const) {
      await db.publishOrgSharedResource({
        createdAt: now,
        id,
        orgId,
        resourceId,
        resourceKind,
        updatedAt: now,
      });
    }

    for (const suffix of suffixes) {
      for (const id of [
        skill.id,
        privateSkill.id,
        local.id,
        sibling.id,
        "missing-publication",
        "foreign-publication",
        "root-wrong-kind",
      ]) {
        expect((await read(id, suffix)).status).toBe(404);
      }

      expect((await read(publication.id, suffix, "team_a")).status).toBe(404);
    }

    for (const method of ["PATCH", "DELETE"]) {
      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/skills/${skill.id}`, {
          body: method === "PATCH" ? "{}" : undefined,
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            "parent"
          ),
          method,
        })
      );

      expect(response.status).toBe(403);
    }

    for (const role of ["member"] as const) {
      await db.upsertOrgMember({
        createdAt: now,
        orgId: "parent",
        role,
        userId: "root-reader",
      });

      for (const suffix of suffixes) {
        expect((await read(publication.id, suffix)).status).toBe(404);
      }
    }

    await db.upsertOrgMember({
      createdAt: now,
      orgId: "parent",
      role: "admin",
      userId: "root-reader",
    });

    const source = (await db.getSkill(skill.id))!;
    await db.upsertSkill({ ...source, enabled: false });

    for (const suffix of suffixes) {
      expect((await read(publication.id, suffix)).status).toBe(404);
    }

    await db.upsertSkill(source);

    const platform = await loginPlatformAdminSession(
      app,
      authService,
      db,
      "root-platform@example.com"
    );

    for (const suffix of suffixes) {
      const response = await app.fetch(
        new Request(
          `http://localhost:4310/v1/orgs/parent/shared-resources/${publication.id}/skill${suffix}`,
          {
            headers: platform.headers({}, "parent"),
          }
        )
      );

      expect(response.status).toBe(200);
    }

    await db.deleteOrgSharedResource("parent", publication.id);

    for (const suffix of suffixes) {
      expect((await read(publication.id, suffix)).status).toBe(404);
    }
  });

  test("discovers global skills and syncs them to the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    const result = await service.syncDiscoveredSkills();

    expect(result.discovered).toBe(1);

    const listed = await service.listSkills();
    const weather = listed.skills.find((skill) => skill.name === "weather");

    expect(weather).toBeDefined();
    expect(weather?.hasTool).toBe(true);
  });

  test("includes script issues in skill details", async () => {
    const weatherDir = join(configDir, "agent", "skills", "weather");
    await writeFile(
      join(weatherDir, "SKILL.md"),
      weatherSkillMarkdown.replace(
        "---\n\nCall",
        "scripts: scripts/missing.py\n---\n\nCall"
      )
    );
    const service = new SkillsService(createInMemoryDatabaseAdapter());

    const weather = (await service.listSkills()).skills.find(
      (skill) => skill.name === "weather"
    )!;

    expect((await service.getSkill(weather.id)).skill.scriptIssues).toEqual([
      { path: "scripts/missing.py", reason: "declared but not in the skill" },
    ]);
  });

  test.each([
    [
      "icon.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=",
        "base64"
      ),
    ],
    [
      "icon.svg",
      "image/svg+xml",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
      ),
    ],
  ])("previews %s as image bytes", async (filename, mediaType, bytes) => {
    const service = new SkillsService(createInMemoryDatabaseAdapter());

    const skill = (await service.listSkills()).skills.find(
      (item) => item.name === "weather"
    )!;

    await writeFile(join(skill.sourcePath, filename), bytes);
    const result = await service.readSkillFile(ORG_ID, skill.id, filename);
    expect(result.image?.mediaType).toBe(mediaType);
    expect(Buffer.from(result.image!.dataBase64, "base64")).toEqual(bytes);
    expect(result.content).toBeNull();
    expect(result.unavailableReason).toBeUndefined();
  });

  test("browses nested skill files without exposing paths outside the skill", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (item) => item.name === "weather"
    )!;

    const directory = join(configDir, "agent", "skills", "weather");
    await mkdir(join(directory, "references", "nested"), { recursive: true });
    await writeFile(
      join(directory, "references", "nested", "guide.md"),
      "# Guide"
    );
    await writeFile(join(directory, "empty.txt"), "");
    await writeFile(join(directory, "image.bin"), Buffer.from([0, 255]));
    await writeFile(join(directory, "large.txt"), "x".repeat(1024 * 1024 + 1));
    const secret = join(configDir, "secret.txt");
    await writeFile(secret, "private");
    await symlink(secret, join(directory, "escape.txt"));

    const listing = await service.listSkillFiles(ORG_ID, skill.id);
    expect(listing.files).toContainEqual({
      path: "references/nested",
      type: "directory",
    });
    expect(listing.files).toContainEqual({
      path: "references/nested/guide.md",
      type: "file",
    });
    expect(listing.files.some((file) => file.path === "escape.txt")).toBe(
      false
    );
    expect(listing.truncated).toBe(false);
    expect(
      (
        await service.readSkillFile(
          ORG_ID,
          skill.id,
          "references/nested/guide.md"
        )
      ).content
    ).toBe("# Guide");
    expect(
      (await service.readSkillFile(ORG_ID, skill.id, "empty.txt")).content
    ).toBe("");
    expect(
      (await service.readSkillFile(ORG_ID, skill.id, "image.bin")).content
    ).toBeNull();
    expect(
      (await service.readSkillFile(ORG_ID, skill.id, "large.txt")).content
    ).toBeNull();

    for (const target of [
      "../secret.txt",
      secret,
      "escape.txt",
      "references",
      "missing.md",
      "",
      "bad\0file",
    ]) {
      await expect(
        service.readSkillFile(ORG_ID, skill.id, target)
      ).rejects.toThrow();
    }

    const record = await db.getSkill(skill.id);
    await db.upsertSkill({ ...record!, orgId: "another_org" });
    await expect(service.listSkillFiles(ORG_ID, skill.id)).rejects.toThrow();
    await expect(
      service.readSkillFile(ORG_ID, skill.id, "SKILL.md")
    ).rejects.toThrow();
  });

  test("matches weather skill instructions for weather questions", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: PROFILE_ID,
      orgId: ORG_ID,
    });
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();

    const weather = (await service.listSkills()).skills.find(
      (skill) => skill.name === "weather"
    );

    expect(weather).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, weather!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "What's the weather in Jakarta?"
    );

    expect(matched).toContain(weather!.description);
    expect(matched).not.toContain(weatherSkillBody);
  });

  test("includes full skill body for explicit skill activation", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: PROFILE_ID,
      orgId: ORG_ID,
    });
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();

    const weather = (await service.listSkills()).skills.find(
      (skill) => skill.name === "weather"
    );

    expect(weather).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, weather!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "/skill weather"
    );

    expect(matched).toContain(weather!.description);
    expect(matched).toContain(weatherSkillBody);
  });

  test("includes full body for bundled create-automation matches", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: PROFILE_ID,
      orgId: ORG_ID,
    });
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-automation"
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Schedule a daily summary at 9am"
    );

    expect(matched).toContain(skill!.description);
    expect(matched).toContain("runAt");
  });

  test("does not include create-automation body for unrelated messages", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: PROFILE_ID,
      orgId: ORG_ID,
    });
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-automation"
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Explain how TLS works"
    );

    expect(matched).toBe("");
  });

  test("can append context only for matched skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: PROFILE_ID,
      orgId: ORG_ID,
    });
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-profile"
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Create a support bot profile",
      {
        appendContext: (skills) =>
          skills.some((entry) => entry.name === "create-profile")
            ? "# Available Tools\n- read_file\n- write_file\n- edit_file"
            : "",
      }
    );

    expect(matched).toContain(skill!.description);
    expect(matched).toContain("# Available Tools");

    const unrelated = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Explain TLS",
      {
        appendContext: () =>
          "# Available Tools\n- read_file\n- write_file\n- edit_file",
      }
    );

    expect(unrelated).toBe("");
  });

  test("creates profile skills and syncs them to the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const response = await service.createSkill(ORG_ID, {
      body: "Use this skill when the user asks to save a note.",
      description: "Capture notes for the user.",
      name: "notes",
      profileId: PROFILE_ID,
    });

    expect(response.skill.name).toBe("notes");
    expect(response.skill.sourcePath).toContain(
      join("orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "notes")
    );

    const listed = await service.listSkills();
    expect(listed.skills.some((skill) => skill.name === "notes")).toBe(true);
  });

  test("deletes profile skills from disk and the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const created = await service.createSkill(ORG_ID, {
      description: "Capture notes for the user.",
      name: "notes",
      profileId: PROFILE_ID,
    });

    await service.deleteSkill(created.skill.id);

    const listed = await service.listSkills();
    expect(listed.skills.some((skill) => skill.name === "notes")).toBe(false);
  });

  test("rejects deleting bundled system skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const listed = await service.listSkills();

    const agentBrowser = listed.skills.find(
      (skill) => skill.name === "agent-browser"
    );

    expect(agentBrowser).toBeTruthy();

    await expect(service.deleteSkill(agentBrowser!.id)).rejects.toThrow();

    const after = await service.listSkills();

    expect(after.skills.some((skill) => skill.id === agentBrowser!.id)).toBe(
      true
    );
  });

  test("composes always-on agent-browser capability prompt when assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: PROFILE_ID,
      orgId: ORG_ID,
    });
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const agentBrowser = (await service.listSkills()).skills.find(
      (skill) => skill.name === "agent-browser"
    );

    expect(agentBrowser).toBeDefined();

    expect(
      await service.composeAgentBrowserCapabilityForProfile(ORG_ID, PROFILE_ID)
    ).toBe("");

    await db.assignSkillToProfile(PROFILE_ID, agentBrowser!.id);

    const prompt = await service.composeAgentBrowserCapabilityForProfile(
      ORG_ID,
      PROFILE_ID
    );

    expect(prompt).toContain("agent-browser skill");
    expect(prompt).toContain("/skill agent-browser");
    expect(prompt).toContain("screenshot artifacts/");
  });

  test("deduplicates skills discovered from global and profile directories", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const skillMarkdown = `---
name: coding-backend-claude-code
description: Runtime prompt layer for Claude Code delegated coding runs.
disable-model-invocation: true
---

Use Claude Code guidance.
`;

    const globalDir = join(
      configDir,
      "agent",
      "skills",
      "coding-backend-claude-code"
    );

    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "coding-backend-claude-code"
    );

    await mkdir(globalDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(globalDir, "SKILL.md"), skillMarkdown);
    await writeFile(join(profileDir, "SKILL.md"), skillMarkdown);

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const listed = await service.listSkills();

    const matches = listed.skills.filter(
      (skill) => skill.name === "coding-backend-claude-code"
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourcePath).toContain(join("agent", "skills"));
  });

  test("syncs profile-scoped skills without scanning every profile directory", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "notes"
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Use this skill when the user asks to save a note.
`
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const listed = await service.listSkills();
    const notes = listed.skills.find((skill) => skill.name === "notes");

    expect(notes).toBeDefined();
    expect(notes?.sourcePath).toContain(
      join("orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "notes")
    );
  });

  test("patchSkill updates skill body on disk", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "notes"
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Original body.
`
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const notes = (await service.listSkills()).skills.find(
      (skill) => skill.name === "notes"
    );

    expect(notes).toBeDefined();

    const patched = await service.patchSkill(ORG_ID, notes!.id, {
      body: "Updated body.",
    });

    expect(patched.skill.body).toBe("Updated body.");

    const detail = await service.getSkill(notes!.id);
    expect(detail.skill.body).toBe("Updated body.");
  });

  test("patchSkill records SKILL.md versions", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "notes"
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Original body.
`
    );
    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const notes = (await service.listSkills()).skills.find(
      (skill) => skill.name === "notes"
    );

    const meta = { actorUserId: "user_1", source: "dashboard" as const };

    await service.patchSkill(ORG_ID, notes!.id, { body: "First." }, { meta });
    await service.patchSkill(ORG_ID, notes!.id, { body: "Second." }, { meta });
    await service.patchSkill(ORG_ID, notes!.id, { body: "Second." }, { meta });

    const { versions } = await service.listSkillVersions(ORG_ID, notes!.id);
    expect(
      versions.map(({ kind, source, version }) => ({ kind, source, version }))
    ).toEqual([
      { kind: "updated", source: "dashboard", version: 3 },
      { kind: "updated", source: "dashboard", version: 2 },
      { kind: "original", source: null, version: 1 },
    ]);
    expect(versions[2]?.content).toContain("Original body.");
    expect(versions[0]?.content).toContain("Second.");
    await expect(
      service.listSkillVersions("org_other", notes!.id)
    ).rejects.toMatchObject({ status: 404 });
  });

  test("skill versions keep notes, restore, and show pending proposals", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "notes"
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Original body.
`
    );
    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const notes = (await service.listSkills()).skills.find(
      (skill) => skill.name === "notes"
    );

    await service.patchSkill(ORG_ID, notes!.id, {
      body: "First.",
      note: "Shorter steps",
    });
    const before = await service.listSkillVersions(ORG_ID, notes!.id);
    expect(before.versions[0]?.note).toBe("Shorter steps");

    const original = before.versions.find(
      (version) => version.kind === "original"
    );

    const restored = await service.restoreSkillVersion(
      ORG_ID,
      notes!.id,
      original!.id
    );

    expect(restored.skill.body.trim()).toBe("Original body.");
    const after = await service.listSkillVersions(ORG_ID, notes!.id);
    expect(after.versions[0]).toMatchObject({ kind: "restored", version: 3 });
    expect(after.versions[0]?.content).toBe(original!.content);
    await expect(
      service.restoreSkillVersion("org_other", notes!.id, original!.id)
    ).rejects.toMatchObject({ status: 404 });

    await db.createSkillProposal({
      action: "patch",
      content: null,
      createdAt: new Date().toISOString(),
      id: "skprop_1",
      orgId: ORG_ID,
      patchNewString: "Proposed body.",
      patchOldString: "Original body.",
      profileId: PROFILE_ID,
      proposedByUserId: null,
      relativePath: null,
      resecondaryMemberUserId: null,
      reviewedAt: null,
      sessionId: null,
      skillName: "notes",
      status: "pending",
    });
    const withPending = await service.listSkillVersions(ORG_ID, notes!.id);
    expect(withPending.pending.map((entry) => entry.id)).toEqual(["skprop_1"]);
    expect(withPending.pending[0]?.content).toContain("Proposed body.");
    expect(withPending.pending[0]?.content).not.toContain("Original body.");
  });

  test("patchSkill keeps the scripts the skill ships", async () => {
    // A patch edits prose. Rewriting the frontmatter without `scripts:` left
    // the skill installed and every one of its scripts unreachable, with
    // nothing on screen saying so, which is how a dashboard edit silently
    // disabled a working skill.
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "beams"
    );

    await mkdir(join(profileDir, "scripts"), { recursive: true });
    await writeFile(
      join(profileDir, "scripts", "beam.py"),
      'def run(input, context):\n    return {}\n\nif __name__ == "__main__":\n' +
        "    import sys, json\n" +
        "    sys.stdout.write(json.dumps(run(json.loads(sys.stdin.read() or '{}'), {})))\n"
    );
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: beams
description: Check a beam.
scripts: scripts/beam.py
---

Original body.
`
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const beams = (await service.listSkills()).skills.find(
      (skill) => skill.name === "beams"
    );

    expect(beams?.hasTool).toBe(true);

    await service.patchSkill(ORG_ID, beams!.id, { body: "Updated body." });

    const onDisk = await readFile(join(profileDir, "SKILL.md"), "utf8");
    expect(onDisk).toContain("scripts: scripts/beam.py");

    const after = (await service.listSkills()).skills.find(
      (skill) => skill.name === "beams"
    );

    expect(after?.hasTool).toBe(true);
  });

  test("editAssignedProfileSkill replaces SKILL.md and refuses rename", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    await service.createAndAssignRawSkillToProfile(
      ORG_ID,
      PROFILE_ID,
      `---
name: deploy
description: Deploy the service.
---

Use staging first.
`
    );

    const edited = await service.editAssignedProfileSkill(
      ORG_ID,
      PROFILE_ID,
      "deploy",
      `---
name: deploy
description: Deploy with canary.
---

Use canary then prod.
`
    );

    expect(edited.skill.description).toBe("Deploy with canary.");
    expect(edited.skill.body.trim()).toBe("Use canary then prod.");

    await expect(
      service.editAssignedProfileSkill(
        ORG_ID,
        PROFILE_ID,
        "deploy",
        `---
name: other
description: Renamed.
---

Nope.
`
      )
    ).rejects.toThrow();

    const unchanged = (await service.listSkills()).skills.find(
      (skill) => skill.name === "deploy"
    );

    expect(unchanged?.description).toBe("Deploy with canary.");
  });
});
