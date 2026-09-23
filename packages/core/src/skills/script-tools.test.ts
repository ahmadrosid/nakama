import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSkillScripts } from "./script-tools";

const BODY = "def hitung(b, h):\n    return b * h * h / 6\n";
const HARNESS =
  '\ndef run(input, context):\n    return {"w": hitung(input["b"], input["h"])}\n\n' +
  'if __name__ == "__main__":\n    import sys, json\n' +
  "    sys.stdout.write(json.dumps(run(json.loads(sys.stdin.read() or '{}'), {})))\n";

async function skillDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-scripts-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(dir, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test("a script nothing can run is reported instead of ignored", async () => {
  // The three layouts an author reaches for first, none of which any loader
  // reached before. Each used to discover as a skill with no tool at all.
  for (const layout of [
    { "scripts/hitung.py": BODY },
    { "hitung.py": BODY },
    { "helper.js": "export const x = 1;\n" },
  ]) {
    const directory = await skillDir({ "SKILL.md": "---\n---\n", ...layout });
    const resolved = await resolveSkillScripts({
      declared: [],
      directory,
      skillName: "calc",
      toolPath: null,
    });

    expect(resolved.tools).toHaveLength(0);
    expect(resolved.issues).toHaveLength(1);
    expect(resolved.issues[0]?.reason).toContain("not runnable");
    await rm(directory, { force: true, recursive: true });
  }
});

test("a declared script becomes its own tool, named and described from the file", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/hitung_balok.py": `"""Hitung momen balok."""\n${BODY}${HARNESS}`,
  });

  const resolved = await resolveSkillScripts({
    declared: ["scripts/hitung_balok.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.issues).toEqual([]);
  expect(resolved.tools).toHaveLength(1);
  expect(resolved.tools[0]?.name).toBe("calc_hitung_balok");
  expect(resolved.tools[0]?.description).toBe("Hitung momen balok.");
  await rm(directory, { force: true, recursive: true });
});

test("a declared script missing the harness is reported before the agent calls it", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/hitung.py": `${BODY}\ndef run(input, context):\n    return {}\n`,
  });

  const resolved = await resolveSkillScripts({
    declared: ["scripts/hitung.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.tools).toEqual([]);
  expect(resolved.issues[0]?.reason).toBe(
    "has no __main__ JSON stdin/stdout harness"
  );
  await rm(directory, { force: true, recursive: true });
});

test("declaring a script that is not there, or outside the skill, is refused", async () => {
  const directory = await skillDir({ "SKILL.md": "---\n---\n" });

  const resolved = await resolveSkillScripts({
    declared: ["scripts/absent.py", "../escape.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.tools).toEqual([]);
  expect(resolved.issues.map((issue) => issue.reason)).toEqual([
    "declared but not in the skill",
    "path cannot contain '.' or '..' segments",
  ]);
  await rm(directory, { force: true, recursive: true });
});

test("tool.py at the root stays reachable and is not reported twice", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "tool.py": `${BODY}${HARNESS}`,
  });

  const resolved = await resolveSkillScripts({
    declared: [],
    directory,
    skillName: "calc",
    toolPath: path.join(directory, "tool.py"),
  });

  expect(resolved.issues).toEqual([]);
  expect(resolved.tools).toEqual([]);
  await rm(directory, { force: true, recursive: true });
});
