import { afterEach, expect, test } from "bun:test";
import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getPluginReleaseDir,
  type StoredWorkflow,
  type WorkflowRunRecord,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { PluginService } from "./plugin-service";

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

test("official workflow install imports once, executes through IPC, isolates orgs, and disables", async () => {
  const dir = await mkdtemp(join(tmpdir(), "official-workflows-"));
  directories.push(dir);
  const officialPackagesDir = join(dir, "official");
  for (const pluginId of ["workflows", "supermemory"]) {
    await cp(
      resolve(import.meta.dir, "../../../../packages/plugins", pluginId),
      join(officialPackagesDir, pluginId),
      { recursive: true }
    );
  }
  const db = createInMemoryDatabaseAdapter();
  const legacy: StoredWorkflow = {
    description: "",
    enabled: true,
    id: "legacy",
    name: "Legacy",
    orgId: "org_a",
    profileId: "profile_a",
    steps: [{ id: "summary", kind: "summarize", prompt: "Summarize" }],
    version: 1,
  };
  const seen: string[] = [];
  const service = new PluginService(db, dir, {
    officialPackagesDir,
    onHostRequest: async (value, context) => {
      const request = value as Record<string, unknown>;
      seen.push(`${context.orgId}:${request.op}`);
      if (request.op === "legacy_workflows") {
        return context.orgId === "org_a"
          ? [{ runs: [], workflow: legacy }]
          : [];
      }
      if (request.op === "profiles") {
        return [{ id: "profile_a", isDefault: true }];
      }
      if (request.op === "tools") {
        return [{ name: "echo" }];
      }
      if (request.op === "execute_tool") {
        return request.input;
      }
      if (request.op === "summarize") {
        return JSON.stringify(request.bag);
      }
      throw new Error("Unknown request");
    },
  });
  const actor = { id: "admin", role: "admin" as const };
  expect(
    (await service.listOfficialPlugins()).map((plugin) => plugin.id)
  ).toEqual(expect.arrayContaining(["workflows", "supermemory"]));
  await service.installOfficialPlugin("org_a", "workflows", actor);
  const invoke = async (key: string, input = {}, orgId = "org_a") =>
    (
      await service.invokePluginAction({
        access: "ui",
        actionKey: key,
        actor,
        input,
        orgId,
        pluginId: "workflows",
      })
    ).result;
  expect(await invoke("list_workflows")).toEqual([legacy]);
  await invoke("delete_workflow", { workflowId: "legacy" });
  await service.installOfficialPlugin("org_a", "workflows", actor);
  expect(await invoke("list_workflows")).toEqual([]);
  const workflow = (await invoke("create_workflow", {
    name: "Echo",
    steps: [
      {
        id: "echo",
        input: { value: "{{input.value}}" },
        kind: "tool",
        tool: "echo",
      },
      { id: "summary", kind: "summarize", prompt: "Summarize" },
    ],
  })) as StoredWorkflow;
  const result = (await invoke("run_workflow", {
    input: { value: "hello" },
    workflowId: workflow.id,
  })) as { run: WorkflowRunRecord };
  expect(result.run.status).toBe("completed");
  expect(result.run.steps?.map((step) => step.status)).toEqual([
    "completed",
    "completed",
  ]);
  expect(JSON.parse(result.run.output!).steps.echo.value).toBe("hello");
  expect(seen).toContain("org_a:execute_tool");
  await service.installOfficialPlugin("org_b", "workflows", actor);
  expect(await invoke("list_workflows", {}, "org_b")).toEqual([]);
  await expect(
    invoke("run_workflow", { workflowId: workflow.id }, "org_b")
  ).rejects.toThrow();
  const before = (await db.getOrgPlugin("org_a", "workflows"))!;
  const savedWorkflows = await invoke("list_workflows");
  const otherOrg = await db.getOrgPlugin("org_b", "workflows");
  const originalUi = await readFile(
    join(
      getPluginReleaseDir("workflows", before.selectedVersion!, dir),
      "ui/app.js"
    ),
    "utf8"
  );
  await appendFile(
    join(officialPackagesDir, "workflows/ui/app.js"),
    "\n// rebuilt for development\n"
  );
  await expect(
    service.installOfficialPlugin("org_a", "workflows", actor, {
      expectedRevision: before.revision - 1,
    })
  ).rejects.toThrow();
  await expect(
    service.installOfficialPlugin(
      "org_a",
      "workflows",
      { id: "member", role: "member" },
      { expectedRevision: before.revision }
    )
  ).rejects.toThrow();
  expect(await db.getOrgPlugin("org_a", "workflows")).toEqual(before);
  const reinstalled = await service.installOfficialPlugin(
    "org_a",
    "workflows",
    actor,
    { expectedRevision: before.revision }
  );
  expect(reinstalled.lifecycleState).toBe("enabled");
  expect(reinstalled.selectedVersion).not.toBe(before.selectedVersion);
  expect(reinstalled.revision).toBeGreaterThan(before.revision);
  expect(
    await readFile(
      join(
        getPluginReleaseDir("workflows", reinstalled.selectedVersion!, dir),
        "ui/app.js"
      ),
      "utf8"
    )
  ).toBe(`${originalUi}\n// rebuilt for development\n`);
  expect(
    await readFile(
      join(
        getPluginReleaseDir("workflows", before.selectedVersion!, dir),
        "ui/app.js"
      ),
      "utf8"
    )
  ).toBe(originalUi);
  expect(await db.getOrgPlugin("org_b", "workflows")).toEqual(otherOrg);
  expect(await invoke("list_workflows")).toEqual(savedWorkflows);
  expect(
    (
      (await invoke("runs", { workflowId: workflow.id })) as WorkflowRunRecord[]
    )[0]?.id
  ).toBe(result.run.id);
  const repeated = await service.installOfficialPlugin(
    "org_a",
    "workflows",
    actor,
    { expectedRevision: reinstalled.revision }
  );
  expect(repeated.selectedVersion).toBe(reinstalled.selectedVersion);
  expect(repeated.revision).toBeGreaterThan(reinstalled.revision);
  await expect(
    service.installOfficialPlugin("org_a", "workflows", {
      id: "member",
      role: "member",
    })
  ).rejects.toThrow();
  await expect(
    service.invokePluginAction({
      access: "ui",
      actionKey: "list_workflows",
      actor: { id: "viewer", role: "viewer" },
      input: {},
      orgId: "org_a",
      pluginId: "workflows",
    })
  ).rejects.toThrow();
  const install = await db.getOrgPlugin("org_a", "workflows");
  await service.disableOrgPlugin("org_a", "workflows", install!.revision);
  await expect(invoke("list_workflows")).rejects.toThrow();
  const disabled = (await db.getOrgPlugin("org_a", "workflows"))!;
  await appendFile(
    join(officialPackagesDir, "workflows/ui/app.js"),
    "\n// another development build\n"
  );
  const refreshedDisabled = await service.installOfficialPlugin(
    "org_a",
    "workflows",
    actor,
    { expectedRevision: disabled.revision }
  );
  expect(refreshedDisabled.lifecycleState).toBe("disabled");
  expect(refreshedDisabled.selectedVersion).not.toBe(disabled.selectedVersion);
  const ready = await service.enableOrgPlugin(
    "org_a",
    "workflows",
    refreshedDisabled.revision
  );
  await appendFile(
    join(officialPackagesDir, "workflows/migrations/001-workflows.sql"),
    "\nINVALID MIGRATION;\n"
  );
  await expect(
    service.installOfficialPlugin("org_a", "workflows", actor, {
      expectedRevision: ready.revision,
    })
  ).rejects.toThrow();
  const failedReinstall = (await db.getOrgPlugin("org_a", "workflows"))!;
  expect(failedReinstall.lifecycleState).toBe("disabled");
  expect(failedReinstall.selectedVersion).toBe(ready.selectedVersion);
  expect(failedReinstall.databaseGeneration).toBe(ready.databaseGeneration);
  await service.enableOrgPlugin("org_a", "workflows", failedReinstall.revision);
  expect(await invoke("list_workflows")).toEqual(savedWorkflows);
}, 20_000);

test("host capabilities enforce profile tenancy, Super Bot access, and tool assignment", async () => {
  const { createPluginAgentHost } = await import("./plugin-agent-host");
  const db = createInMemoryDatabaseAdapter();
  const now = new Date().toISOString();
  for (const [id, orgId, isSuper] of [
    ["normal", "org_a", false],
    ["super", "org_a", true],
    ["foreign", "org_b", false],
  ] as const) {
    await db.upsertProfile({
      createdAt: now,
      id,
      isDefault: false,
      isSuper,
      model: null,
      name: id,
      orgId,
      systemPrompt: "",
      updatedAt: now,
    });
  }
  const agent = {
    buildPluginToolContext: () => ({}),
    resolvePluginExecutionTools: async () => [
      {
        description: "allowed",
        name: "allowed",
        parameters: { type: "object" },
        run: async () => ({ ok: true }),
      },
      {
        name: "plugin_workflows__run_workflow",
        run: async () => {
          throw new Error("Recursion");
        },
      },
    ],
  };
  const host = createPluginAgentHost(db, agent as never);
  const context = {
    actor: { id: "member", role: "member" as const },
    apiVersion: 1 as const,
    dataDir: "/tmp",
    invocationId: "invocation",
    orgId: "org_a",
    pluginId: "workflows",
    pluginVersion: "1.0.0",
  };
  await expect(
    host({ agentId: "foreign", op: "tools" }, context)
  ).rejects.toThrow();
  await expect(
    host({ agentId: "super", op: "tools" }, context)
  ).rejects.toThrow();
  await expect(host({ op: "legacy_workflows" }, context)).rejects.toThrow();
  expect(await host({ agentId: "normal", op: "tools" }, context)).toEqual([
    { description: "allowed", name: "allowed", parameters: { type: "object" } },
  ]);
  expect(
    await host(
      { agentId: "normal", input: {}, name: "allowed", op: "execute_tool" },
      context
    )
  ).toEqual({ ok: true });
  const denied = await host(
    { agentId: "normal", input: {}, name: "unassigned", op: "execute_tool" },
    context
  );
  expect(denied).toHaveProperty("error");
});

test("official dependencies are checked before publishing or changing org state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "official-dependencies-"));
  directories.push(dir);
  const db = createInMemoryDatabaseAdapter();
  const service = new PluginService(db, dir, {
    officialPackagesDir: resolve(
      import.meta.dir,
      "../../../../packages/plugins"
    ),
  });
  await expect(
    service.installOfficialPlugin("org_a", "workflows", {
      id: "admin",
      role: "admin",
    })
  ).rejects.toThrow();
  expect(await db.getOrgPlugin("org_a", "workflows")).toBeNull();
  const [official] = await service.listOfficialPlugins();
  expect(await db.getPluginRelease("workflows", official!.version)).toBeNull();
});

test("failed official setup disables the new installation and can be retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "official-setup-"));
  directories.push(dir);
  const db = createInMemoryDatabaseAdapter();
  let failSetup = true;
  const service = new PluginService(db, dir, {
    officialPackagesDir: resolve(
      import.meta.dir,
      "../../../../packages/plugins"
    ),
    onHostRequest: async () => {
      if (failSetup) {
        throw new Error("Legacy data is temporarily unavailable.");
      }
      return [];
    },
  });
  const actor = { id: "admin", role: "admin" as const };
  await expect(
    service.installOfficialPlugin("org_a", "workflows", actor)
  ).rejects.toThrow();
  const failed = await db.getOrgPlugin("org_a", "workflows");
  expect(failed?.lifecycleState).toBe("disabled");
  expect(failed?.databaseGeneration).toBeTruthy();
  failSetup = false;
  const retried = await service.installOfficialPlugin(
    "org_a",
    "workflows",
    actor
  );
  expect(retried.lifecycleState).toBe("enabled");
});
