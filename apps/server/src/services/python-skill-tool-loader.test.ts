import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DiscoveredSkill } from "@nakama/core";
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
    description: "Add two numbers",
    name: "adder",
    toolPath,
  } as unknown as DiscoveredSkill);
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
    const result = await tool?.run({ a: 2, b: 3 }, {
      signal: new AbortController().signal,
    } as never);
    expect(result).toEqual({ sum: 5 });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a skill tool that never reads stdin is refused with a reason naming it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "skill-tool-"));
  const toolPath = path.join(directory, "tool.py");
  await writeFile(toolPath, "def run(payload, context):\n    return payload\n");
  try {
    const tool = await loadPythonSkillTool({
      description: "Echo",
      name: "echo",
      toolPath,
    } as unknown as DiscoveredSkill);
    const result = (await tool?.run({}, {
      signal: new AbortController().signal,
    } as never)) as { error: string };
    expect(result.error).toContain("sys.stdin");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
