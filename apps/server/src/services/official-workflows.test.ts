import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StoredWorkflow, WorkflowRunRecord } from "@nakama/core";
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
    officialPackagesDir: resolve("packages/plugins"),
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
  expect((await service.listOfficialPlugins())[0]?.id).toBe("workflows");
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
    officialPackagesDir: resolve("packages/plugins"),
  });
  await expect(
    service.installOfficialPlugin("org_a", "workflows", {
      id: "admin",
      role: "admin",
    })
  ).rejects.toThrow();
  expect(await db.getOrgPlugin("org_a", "workflows")).toBeNull();
  expect(await db.getPluginRelease("workflows", "1.0.0")).toBeNull();
});

test("failed official setup disables the new installation and can be retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "official-setup-"));
  directories.push(dir);
  const db = createInMemoryDatabaseAdapter();
  let failSetup = true;
  const service = new PluginService(db, dir, {
    officialPackagesDir: resolve("packages/plugins"),
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
