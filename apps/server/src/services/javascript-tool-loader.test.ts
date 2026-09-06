import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StoredToolRecord } from "@nakama/db";
import { resolveCustomToolModulePath } from "./custom-tool-shared";
import { loadJavascriptTool } from "./javascript-tool-loader";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

async function setupToolsDir(): Promise<{
  configDir: string;
  toolsDir: string;
}> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "nakama-config-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  const toolsDir = path.join(configDir, "tools");
  await mkdir(toolsDir, { recursive: true });
  return { configDir, toolsDir };
}

function makeRecord(
  overrides: Partial<StoredToolRecord> = {}
): StoredToolRecord {
  return {
    createdAt: new Date().toISOString(),
    description: "Echo a message",
    handlerConfig: { modulePath: "echo.js" },
    handlerType: "javascript",
    id: "tool_echo",
    name: "echo",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("javascript tool loader", () => {
  let configDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
  });

  test("loads a module and runs exported run(input) in a subprocess", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "echo.js"),
      `export async function run(input, context) {
  return { echoed: input.message, root: process.env.NAKAMA_WORKSPACE_ROOT ?? "" };
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(makeRecord());

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("echo");
    expect(tool?.parallelSafe).not.toBe(true);

    const result = (await tool!.run(
      { message: "hello" },
      { workspaceRoot: "/tmp/nakama-ws" }
    )) as { echoed: string; root: string };
    expect(result.echoed).toBe("hello");
    expect(result.root).toBe("/tmp/nakama-ws");
  });

  test("reads parallelSafe from handlerConfig, not the module", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "parallel-echo.js"),
      `export async function run(input, context) {
  return { echoed: input.message };
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({
        handlerConfig: { modulePath: "parallel-echo.js", parallelSafe: true },
        name: "parallel_echo",
      })
    );

    expect(tool?.parallelSafe).toBe(true);
  });

  test("rejects module paths outside the tools directory", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;

    expect(() => resolveCustomToolModulePath("../escape.js")).toThrow(
      /must stay inside/i
    );
  });

  test("returns an error tool when the module file is missing", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;

    const tool = await loadJavascriptTool(makeRecord());
    const result = await tool!.run({}, {});

    expect(result).toEqual({ error: "Tool module not found: echo.js" });
  });

  test("returns an error tool when the module lacks an exported run function", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "norun.js"),
      `async function run(input, context) {
  return input;
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({ handlerConfig: { modulePath: "norun.js" }, name: "norun" })
    );

    const result = (await tool!.run({}, {})) as { error: string };
    expect(result.error).toMatch(/export.*run/i);
  });

  test("returns an error tool when the module exits non-zero", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "boom.js"),
      `export async function run(input, context) {
  console.error("kaboom");
  process.exit(7);
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({ handlerConfig: { modulePath: "boom.js" }, name: "boom" })
    );

    const err = await tool!.run({}, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/exit code/i);
    expect((err as Error).message).toContain("kaboom");
  });

  test("process.exit() inside a tool does not affect the server process", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "hostile-exit.js"),
      `export async function run(input, context) {
  process.exit(1);
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({
        handlerConfig: { modulePath: "hostile-exit.js" },
        name: "hostile_exit",
      })
    );

    const err = await tool!.run({}, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/exit code/i);
    expect(process.pid).toBeGreaterThan(0);
  });

  test("runs with cwd scoped to the tools directory, not the server checkout", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "cwd-probe.js"),
      `export async function run(input, context) {
  return { cwd: process.cwd() };
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({
        handlerConfig: { modulePath: "cwd-probe.js" },
        name: "cwd_probe",
      })
    );

    const result = (await tool!.run({}, {})) as { cwd: string };
    expect(realpathSync(result.cwd)).toBe(realpathSync(toolsDir));
  });

  test("cannot read a secret-shaped env var from the parent process", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "env-probe.js"),
      `export async function run(input, context) {
  return { secret: process.env.NAKAMA_TEST_CANARY_SECRET ?? null };
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({
        handlerConfig: { modulePath: "env-probe.js" },
        name: "env_probe",
      })
    );

    process.env.NAKAMA_TEST_CANARY_SECRET = "canary-not-a-real-secret";
    try {
      const result = (await tool!.run({}, {})) as { secret: string | null };
      expect(result.secret).toBeNull();
    } finally {
      delete process.env.NAKAMA_TEST_CANARY_SECRET;
    }
  });

  test("rejects on timeout even when the module exits 0", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "stubborn.js"),
      `export async function run(input, context) {
  await new Promise(() => {});
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({
        handlerConfig: { modulePath: "stubborn.js" },
        name: "stubborn",
      })
    );

    process.env.NAKAMA_CUSTOM_TOOL_TIMEOUT_MS = "200";
    try {
      const err = await tool!.run({}, {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/timed out/i);
    } finally {
      delete process.env.NAKAMA_CUSTOM_TOOL_TIMEOUT_MS;
    }
  });

  test("concurrent calls to a parallelSafe tool do not share module state", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "counter.js"),
      `let count = 0;

export async function run(input, context) {
  count += 1;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { count };
}
`,
      "utf8"
    );

    const tool = await loadJavascriptTool(
      makeRecord({
        handlerConfig: { modulePath: "counter.js", parallelSafe: true },
        name: "counter",
      })
    );

    const [first, second] = await Promise.all([
      tool!.run({}, {}) as Promise<{ count: number }>,
      tool!.run({}, {}) as Promise<{ count: number }>,
    ]);

    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
  });
});

describe("tool resolver", () => {
  let configDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
  });

  test("resolves javascript tools from storage", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "adder.js"),
      `export async function run(input, context) {
  return { sum: Number(input.a) + Number(input.b) };
}
`,
      "utf8"
    );

    const { resolveToolsFromStorage } = await import("./tool-resolver");
    const tools = await resolveToolsFromStorage([
      {
        createdAt: new Date().toISOString(),
        description: "Add two numbers",
        handlerConfig: { modulePath: "adder.js" },
        handlerType: "javascript",
        id: "tool_adder",
        name: "adder",
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(await tools[0]!.run({ a: 2, b: 3 }, {})).toEqual({ sum: 5 });
  });

  test("skips unsupported handler types", async () => {
    const { resolveToolsFromStorage } = await import("./tool-resolver");
    const tools = await resolveToolsFromStorage([
      {
        createdAt: new Date().toISOString(),
        description: "Unsupported tool",
        handlerConfig: {},
        handlerType: "custom",
        id: "tool_legacy_custom",
        name: "legacy-custom",
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(tools).toHaveLength(0);
  });
});
