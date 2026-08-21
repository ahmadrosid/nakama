import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StoredToolRecord } from "@nakama/db";
import { loadPythonTool, resolvePythonModulePath } from "./python-tool-loader";

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
    handlerConfig: { modulePath: "echo.py" },
    handlerType: "python",
    id: "tool_echo",
    name: "echo",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("python tool loader", () => {
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

  test("loads a module and runs run(input) with JSON over stdin", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "echo.py"),
      `import json, os, sys

def run(input, context):
    return {"echoed": input.get("message"), "root": os.environ.get("NAKAMA_WORKSPACE_ROOT", "")}

if __name__ == "__main__":
    payload = json.loads(sys.stdin.read() or "{}")
    sys.stdout.write(json.dumps(run(payload, {})))
`,
      "utf8"
    );

    const tool = await loadPythonTool(makeRecord());

    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("echo");
    expect(tool?.parallelSafe).not.toBe(true);

    const result = (await tool!.run(
      { message: "hello" },
      { workspaceRoot: "/tmp/nakama-ws" }
    )) as { echoed: string; root: string };
    expect(result.echoed).toBe("hello");
    // The loader must forward context.workspaceRoot to the child process as
    // NAKAMA_WORKSPACE_ROOT.
    expect(result.root).toBe("/tmp/nakama-ws");
  });

  test("returns an error tool when the module file is missing", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;

    const tool = await loadPythonTool(makeRecord());
    const result = (await tool!.run({}, {})) as { error: string };

    expect(result.error).toContain("echo.py");
  });

  test("returns an error tool when the module lacks a run function", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "norun.py"),
      `# no run() defined
print("hi")
`,
      "utf8"
    );

    const tool = await loadPythonTool(
      makeRecord({ handlerConfig: { modulePath: "norun.py" }, name: "norun" })
    );

    const result = (await tool!.run({}, {})) as { error: string };
    expect(result.error).toMatch(/run\s*\(/i);
  });

  test("returns an error tool when the module exits non-zero", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "boom.py"),
      `import sys
def run(input, context):
    sys.stderr.write("kaboom\\n")
    sys.exit(7)

if __name__ == "__main__":
    run({}, {})
`,
      "utf8"
    );

    const tool = await loadPythonTool(
      makeRecord({ handlerConfig: { modulePath: "boom.py" }, name: "boom" })
    );
    const result = (await tool!.run({}, {})) as { error: string };

    expect(result.error).toMatch(/exit code/i);
    expect(result.error).toContain("kaboom");
  });

  test("returns an error tool when stdout is not valid JSON", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "badjson.py"),
      `import sys
def run(input, context):
    sys.stdout.write("not json")
    return None

if __name__ == "__main__":
    run({}, {})
`,
      "utf8"
    );

    const tool = await loadPythonTool(
      makeRecord({
        handlerConfig: { modulePath: "badjson.py" },
        name: "badjson",
      })
    );
    const result = (await tool!.run({}, {})) as { error: string };

    expect(result.error).toMatch(/non-json/i);
  });

  test("returns an error tool when the module prints nothing to stdout", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "silent.py"),
      `def run(input, context):
    return None

if __name__ == "__main__":
    run({}, {})
`,
      "utf8"
    );

    const tool = await loadPythonTool(
      makeRecord({
        handlerConfig: { modulePath: "silent.py" },
        name: "silent",
      })
    );
    const result = (await tool!.run({}, {})) as { error?: unknown };

    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/no output/i);
  });

  test("rejects on timeout even when the module exits 0", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "stubborn.py"),
      `import json, signal, sys, time

got_sigterm = False

def run(input, context):
    return {"ok": True}

def _on_sigterm(signum, frame):
    global got_sigterm
    got_sigterm = True

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _on_sigterm)
    payload = json.loads(sys.stdin.read() or "{}")
    sys.stdout.write(json.dumps(run(payload, {})))
    sys.stdout.flush()
    while not got_sigterm:
        time.sleep(0.02)
    sys.exit(0)
`,
      "utf8"
    );

    const tool = await loadPythonTool(
      makeRecord({
        handlerConfig: { modulePath: "stubborn.py" },
        name: "stubborn",
      })
    );

    process.env.NAKAMA_PYTHON_TOOL_TIMEOUT_MS = "200";
    try {
      const result = (await tool!.run({}, {})) as { error?: unknown };
      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(/timed out/i);
    } finally {
      delete process.env.NAKAMA_PYTHON_TOOL_TIMEOUT_MS;
    }
  });

  test("rejects module paths outside the tools directory", async () => {
    const { configDir: dir } = await setupToolsDir();
    configDir = dir;

    expect(() => resolvePythonModulePath("../escape.py")).toThrow(
      /must stay inside/i
    );
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

  test("resolves python tools from storage", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "adder.py"),
      `import json, sys

def run(input, context):
    return {"sum": int(input["a"]) + int(input["b"])}

if __name__ == "__main__":
    sys.stdout.write(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))
`,
      "utf8"
    );

    const { resolveToolsFromStorage } = await import("./tool-resolver");
    const tools = await resolveToolsFromStorage([
      {
        createdAt: new Date().toISOString(),
        description: "Add two numbers",
        handlerConfig: { modulePath: "adder.py" },
        handlerType: "python",
        id: "tool_adder_py",
        name: "adder_py",
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(await tools[0]!.run({ a: 2, b: 3 }, {})).toEqual({ sum: 5 });
  });
});

describe("agent-service playground dispatch", () => {
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

  test("runToolPlayground executes a python tool instead of its error stub", async () => {
    const { configDir: dir, toolsDir } = await setupToolsDir();
    configDir = dir;

    await writeFile(
      path.join(toolsDir, "shout.py"),
      `import json, sys

def run(input, context):
    return {"shouted": str(input.get("message", "")).upper()}

if __name__ == "__main__":
    sys.stdout.write(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))
`,
      "utf8"
    );

    const { createInMemoryDatabaseAdapter } = await import("@nakama/db");
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await databaseAdapter.upsertOrganization({
      createdAt: now,
      id: "org_playground",
      name: "Playground Org",
      slug: "playground-org",
      updatedAt: now,
    });
    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: "profile_playground",
      isSuper: false,
      model: null,
      name: "playground",
      orgId: "org_playground",
      systemPrompt: "",
      updatedAt: now,
    });
    await databaseAdapter.upsertTool({
      createdAt: now,
      description: "Shout a message",
      handlerConfig: { modulePath: "shout.py" },
      handlerType: "python",
      id: "tool_shout",
      name: "shout",
      updatedAt: now,
    });
    await databaseAdapter.assignToolToProfile(
      "profile_playground",
      "tool_shout"
    );

    const { AgentService } = await import("./agent-service");
    const agentService = new AgentService(null, null, databaseAdapter);

    const response = await agentService.runToolPlayground(
      "tool_shout",
      { message: "hello" },
      { orgId: "org_playground", userId: "user_1" }
    );

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ shouted: "HELLO" });
  });
});
