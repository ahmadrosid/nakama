import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type DiscoveredSkill, getSkillPythonEnvBin } from "@nakama/core";
import { loadPythonSkillTool } from "./python-skill-tool-loader";

const BODY = `"""Add two numbers."""
import json
import sys


def run(payload, context):
    return {"sum": payload["a"] + payload["b"]}


if __name__ == "__main__":
`;

async function toolFor(lastLine: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skill-tool-"));
  const toolPath = path.join(directory, "tool.py");
  await writeFile(toolPath, `${BODY}    ${lastLine}\n`);

  const tool = await loadPythonSkillTool({
    body: "",
    description: "Add two numbers",
    directory,
    disableModelInvocation: false,
    hasTool: true,
    includeBodyOnMatch: true,
    name: "adder",
    scriptIssues: [],
    scriptTools: [],
    skillFilePath: toolPath,
    toolPath,
  } satisfies DiscoveredSkill);

  return { directory, tool };
}

// Both spellings reach stdout and both work when run by hand. Requiring the
// literal string sys.stdout refused the first one at load time, and said the
// harness was missing from a file that had one.
test.each([
  'print(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))',
  'sys.stdout.write(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))',
])("a skill tool that writes its result with %s runs", async (lastLine) => {
  const { directory, tool } = await toolFor(lastLine);

  try {
    expect(tool).not.toBeNull();

    // SAFETY: The test fixture matches the contract used by this test.
    const result = await tool?.run({ a: 2, b: 3 }, {
      signal: new AbortController().signal,
    } as never);

    expect(result).toEqual({ sum: 5 });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

// The interpreter a skill runs under is what makes its own packages importable,
// so this checks which binary actually ran, not that a path was computed.
test.skipIf(process.platform === "win32")(
  "a skill with an installed environment runs under that environment's python",
  async () => {
    const previous = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
      path.join(os.tmpdir(), "skill-env-")
    );

    const { directory, tool } = await toolFor(
      'sys.stdin.read(); print(json.dumps({"env": __import__("os").environ.get("FROM_SKILL_ENV")}))'
    );

    try {
      const bin = getSkillPythonEnvBin(directory);
      await mkdir(path.dirname(bin), { recursive: true });
      await writeFile(bin, '#!/bin/sh\nFROM_SKILL_ENV=yes exec python3 "$@"\n');
      await chmod(bin, 0o755);

      // SAFETY: The test fixture matches the contract used by this test.
      const result = await tool?.run({}, {
        signal: new AbortController().signal,
      } as never);

      expect(result).toEqual({ env: "yes" });
    } finally {
      await rm(directory, { force: true, recursive: true });
      await rm(process.env.NAKAMA_CONFIG_DIR, { force: true, recursive: true });

      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }
    }
  }
);

test("a skill tool that never reads stdin is refused with a reason naming it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skill-tool-"));
  const toolPath = path.join(directory, "tool.py");
  await writeFile(toolPath, "def run(payload, context):\n    return payload\n");

  try {
    const tool = await loadPythonSkillTool({
      body: "",
      description: "Echo",
      directory,
      disableModelInvocation: false,
      hasTool: true,
      includeBodyOnMatch: true,
      name: "echo",
      scriptIssues: [],
      scriptTools: [],
      skillFilePath: toolPath,
      toolPath,
    } satisfies DiscoveredSkill);

    // SAFETY: The test fixture matches the contract used by this test.
    const result = (await tool?.run({}, {
      signal: new AbortController().signal,
    } as never)) as { error: string };

    expect(result.error).toContain("sys.stdin");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a skill tool subprocess does not receive the deployment config dir", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skill-tool-"));
  const toolPath = path.join(directory, "tool.py");
  await writeFile(
    toolPath,
    `import json
import os
import sys


def run(payload, context):
    return {"config_dir": os.environ.get("NAKAMA_CONFIG_DIR")}


if __name__ == "__main__":
    print(json.dumps(run(json.loads(sys.stdin.read() or "{}"), {})))
`,
    "utf8"
  );
  const previous = process.env.NAKAMA_CONFIG_DIR;

  process.env.NAKAMA_CONFIG_DIR = directory;

  try {
    const tool = await loadPythonSkillTool({
      body: "",
      description: "Report the config dir",
      directory,
      disableModelInvocation: false,
      hasTool: true,
      includeBodyOnMatch: true,
      name: "config_reader",
      scriptIssues: [],
      scriptTools: [],
      skillFilePath: toolPath,
      toolPath,
    } satisfies DiscoveredSkill);

    // SAFETY: The test fixture matches the contract used by this test.
    const result = await tool?.run({}, {
      signal: new AbortController().signal,
    } as never);

    expect(result).toEqual({ config_dir: null });
  } finally {
    if (previous === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});
