import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getUserConfigPath,
  parseIniWithSections,
  writeParsedConfigIni,
} from "@nakama/core";
import {
  loadToolApiKey,
  loadToolEnv,
  parseToolEnvDeclarations,
  resolveCustomToolModulePath,
  saveToolApiKey,
  saveToolEnv,
} from "./custom-tool-shared";
import {
  makeCustomToolRecord,
  setupCustomToolsDir,
} from "./custom-tool-test-helpers";
import { loadJavascriptTool } from "./javascript-tool-loader";
import { loadPythonTool } from "./python-tool-loader";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
const setupToolsDir = setupCustomToolsDir;
const makeRecord = makeCustomToolRecord;

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

  test("credentials stay scoped, are injected for both runtimes, and are redacted from results and failures", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;
    const apiKey = 'test-key-with-"quotes"\\slash';
    await writeFile(
      path.join(toolsDir, "credential.js"),
      `export async function run(input) {
      const key = process.env.NAKAMA_TOOL_API_KEY;
      if (input.fail) throw new Error("bad key " + key);
      return { present: Boolean(key), echo: key, nested: [key], count: 1 };
    }`
    );
    const record = makeRecord({
      handlerConfig: { modulePath: "credential.js", requiresApiKey: true },
    });
    const tool = (await loadJavascriptTool(record))!;
    expect(await tool.run({}, { orgId: "org_a" })).toMatchObject({
      orgId: "org_a",
      toolId: record.id,
      type: "tool_credentials_required",
    });
    await Promise.all([
      saveToolApiKey("org_a", record.id, apiKey),
      saveToolApiKey("org_b", record.id, "other-key"),
    ]);
    expect(await loadToolApiKey("org_a", record.id)).toBe(apiKey);
    expect(await loadToolApiKey("org_b", record.id)).toBe("other-key");
    expect(await loadToolApiKey("org_a", "another_tool")).toBeUndefined();
    expect(await tool.run({}, { orgId: "org_a" })).toEqual({
      count: 1,
      echo: "[REDACTED]",
      nested: ["[REDACTED]"],
      present: true,
    });
    expect(await tool.run({}, { orgId: "org_c" })).toMatchObject({
      type: "tool_credentials_required",
    });
    await expect(tool.run({ fail: true }, { orgId: "org_a" })).rejects.toThrow(
      "bad key [REDACTED]"
    );
    await expect(tool.run({}, {})).rejects.toThrow();
    await saveToolApiKey("org_a", record.id, "1");
    expect(await tool.run({}, { orgId: "org_a" })).toMatchObject({
      count: 1,
      echo: "[REDACTED]",
    });
    for (const invalid of ["", " \n", "key\n[provider.evil]", "key\0", 123]) {
      expect(() => saveToolApiKey("org_a", record.id, invalid)).toThrow();
    }
    await writeFile(
      path.join(toolsDir, "credential.py"),
      `import os, sys, json
def run(input, context):
    return {"present": bool(os.environ.get("NAKAMA_TOOL_API_KEY")), "echo": os.environ.get("NAKAMA_TOOL_API_KEY")}
if __name__ == "__main__":
    sys.stdout.write(json.dumps(run(json.load(sys.stdin), {})))
`
    );
    const python = (await loadPythonTool(
      makeRecord({
        handlerConfig: { modulePath: "credential.py", requiresApiKey: true },
        handlerType: "python",
      })
    ))!;
    expect(await python.run({}, { orgId: "org_a" })).toEqual({
      echo: "[REDACTED]",
      present: true,
    });
  });

  test("tool API keys are encrypted at rest and bound to their org", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;
    await saveToolApiKey("org_a", "tool_x", "plain-secret-value");
    expect(await readFile(getUserConfigPath(), "utf8")).not.toContain(
      "plain-secret-value"
    );
    const keyFile = await stat(path.join(dir, "tool-credentials.key"));
    // Windows does not expose POSIX owner/group permission bits.
    if (process.platform !== "win32") {
      expect(keyFile.mode % 0o1000).toBe(0o600);
    }
    expect(await loadToolApiKey("org_a", "tool_x")).toBe("plain-secret-value");

    const parsed = parseIniWithSections(
      await readFile(getUserConfigPath(), "utf8")
    );
    const [sectionA] = Object.keys(parsed.sections);
    await saveToolApiKey("org_b", "tool_x", "org-b-value");
    const afterB = parseIniWithSections(
      await readFile(getUserConfigPath(), "utf8")
    );
    const sectionB = Object.keys(afterB.sections).find(
      (name) => name !== sectionA
    )!;
    afterB.sections[sectionB] = parsed.sections[sectionA!]!;
    await writeParsedConfigIni(afterB.global, afterB.sections);
    await expect(loadToolApiKey("org_b", "tool_x")).rejects.toThrow();

    afterB.sections[sectionB] = { api_key: "legacy-plain" };
    await writeParsedConfigIni(afterB.global, afterB.sections);
    expect(await loadToolApiKey("org_b", "tool_x")).toBe("legacy-plain");
  });

  test("declared env values reach the tool, and only secrets are redacted", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;
    await writeFile(
      path.join(toolsDir, "env-tool.js"),
      `export async function run() {
      return {
        url: process.env.WEATHER_API_URL,
        key: process.env.WEATHER_API_KEY,
        path: Boolean(process.env.PATH),
      };
    }`
    );
    const env = [
      { name: "WEATHER_API_URL" },
      { name: "WEATHER_API_KEY", secret: true },
    ];
    const record = makeRecord({
      handlerConfig: { env, modulePath: "env-tool.js" },
    });
    const tool = (await loadJavascriptTool(record))!;
    const declared = parseToolEnvDeclarations(env);
    expect(await tool.run({}, { orgId: "org_a" })).toMatchObject({
      missing: ["WEATHER_API_URL", "WEATHER_API_KEY"],
      type: "tool_credentials_required",
    });
    await saveToolEnv("org_a", record.id, declared, {
      WEATHER_API_URL: "https://api.example.com",
    });
    expect(await tool.run({}, { orgId: "org_a" })).toMatchObject({
      missing: ["WEATHER_API_KEY"],
    });
    await saveToolEnv("org_a", record.id, declared, {
      WEATHER_API_KEY: "secret-weather-key",
    });
    await saveToolApiKey("org_a", record.id, "legacy-key");
    expect(await loadToolEnv("org_a", record.id)).toEqual({
      WEATHER_API_KEY: "secret-weather-key",
      WEATHER_API_URL: "https://api.example.com",
    });
    expect(await tool.run({}, { orgId: "org_a" })).toEqual({
      key: "[REDACTED]",
      path: true,
      url: "https://api.example.com",
    });
    expect(await readFile(getUserConfigPath(), "utf8")).not.toContain(
      "secret-weather-key"
    );
    expect(await tool.run({}, { orgId: "org_b" })).toMatchObject({
      type: "tool_credentials_required",
    });
    expect(() =>
      saveToolEnv("org_a", record.id, declared, { OTHER_NAME: "x" })
    ).toThrow();
    expect(() =>
      saveToolEnv("org_a", record.id, declared, { WEATHER_API_URL: "a\nb" })
    ).toThrow();
  });

  test("env declarations refuse names that change how the tool starts", () => {
    for (const name of [
      "PATH",
      "NODE_OPTIONS",
      "PYTHONPATH",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "NAKAMA_TOOL_API_KEY",
      "BUN_OPTIONS",
      "lower_case",
      "WITH-DASH",
    ]) {
      expect(() => parseToolEnvDeclarations([{ name }])).toThrow();
    }
    expect(() =>
      parseToolEnvDeclarations([{ name: "A_URL" }, { name: "A_URL" }])
    ).toThrow();
    let refused: unknown;
    try {
      parseToolEnvDeclarations([{ name: "NODE_OPTIONS" }]);
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ status: 400 });
    expect(parseToolEnvDeclarations([{ name: "A_URL" }])).toEqual([
      { name: "A_URL", secret: false },
    ]);
  });

  test("a saved key reaches a tool registered without requiresApiKey", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;
    await writeFile(
      path.join(toolsDir, "optional-key.js"),
      `export async function run() {
      return { present: Boolean(process.env.NAKAMA_TOOL_API_KEY) };
    }`
    );
    const record = makeRecord({
      handlerConfig: { modulePath: "optional-key.js" },
    });
    const tool = (await loadJavascriptTool(record))!;
    expect(await tool.run({}, { orgId: "org_a" })).toEqual({ present: false });
    expect(await tool.run({}, {})).toEqual({ present: false });
    await saveToolApiKey("org_a", record.id, "optional-key");
    expect(await tool.run({}, { orgId: "org_a" })).toEqual({ present: true });
    expect(await tool.run({}, { orgId: "org_b" })).toEqual({ present: false });
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
