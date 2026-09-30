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
    "has no __main__ block reading sys.stdin"
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

test("a module docstring with its summary on the next line still describes the tool", async () => {
  // PEP 257 puts the summary below the quotes on a multi line docstring, and
  // that is how the nine modules in the skill this was tried against were
  // written. Reading only the opening line left every one of them nameless.
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/hitung_balok.py": `"""\nSection modulus of a rectangle.\n\nLonger prose nobody needs in a tool description.\n"""\n${BODY}${HARNESS}`,
  });
  const resolved = await resolveSkillScripts({
    declared: ["scripts/hitung_balok.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.tools[0]?.description).toBe(
    "Section modulus of a rectangle."
  );
  await rm(directory, { force: true, recursive: true });
});

test("a script missing both pieces is told about both at once", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/hitung_balok.py": BODY,
  });
  const resolved = await resolveSkillScripts({
    declared: ["scripts/hitung_balok.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  const reason = resolved.issues[0]?.reason ?? "";
  expect(reason).toContain("run(input, context)");
  expect(reason).toContain("sys.stdin");
  await rm(directory, { force: true, recursive: true });
});

test("a skill name providers would reject is slugified, and a long one is trimmed", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/hitung_balok.py": `"""Section modulus."""\n${BODY}${HARNESS}`,
  });
  const punctuated = await resolveSkillScripts({
    declared: ["scripts/hitung_balok.py"],
    directory,
    skillName: "RKK v2.1",
    toolPath: null,
  });

  expect(punctuated.tools[0]?.name).toBe("RKK_v2_1_hitung_balok");

  const long = await resolveSkillScripts({
    declared: ["scripts/hitung_balok.py"],
    directory,
    skillName: "a".repeat(80),
    toolPath: null,
  });
  const name = long.tools[0]?.name ?? "";

  expect(name.length).toBeLessThanOrEqual(64);
  // The file half survives whole, because that is what separates two tools of
  // the same skill from each other.
  expect(name.endsWith("_hitung_balok")).toBe(true);
  await rm(directory, { force: true, recursive: true });
});

test("a script that needs a package Python does not ship says so at discovery", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/chart.py": `"""Draw a chart."""\nimport json\nimport matplotlib.pyplot as plt\nfrom reportlab.lib import colors\n${BODY}${HARNESS}`,
  });
  const resolved = await resolveSkillScripts({
    declared: ["scripts/chart.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  // Still a tool: the dependency is a warning about the runtime, not a defect
  // in the script.
  expect(resolved.tools).toHaveLength(1);
  const reason =
    resolved.issues.find((i) => i.path === "scripts/chart.py")?.reason ?? "";
  expect(reason).toContain("matplotlib");
  expect(reason).toContain("reportlab");
  // json ships with Python and must not be named.
  expect(reason).not.toContain("json");
  await rm(directory, { force: true, recursive: true });
});

test("a script that only uses the standard library is reported clean", async () => {
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/plain.py": `"""Plain maths."""\nimport math\nfrom decimal import Decimal\n${BODY}${HARNESS}`,
  });
  const resolved = await resolveSkillScripts({
    declared: ["scripts/plain.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.tools).toHaveLength(1);
  expect(resolved.issues).toHaveLength(0);
  await rm(directory, { force: true, recursive: true });
});

test("a skill's own modules are not mistaken for packages to install", async () => {
  // Python puts the running script's directory first on sys.path, so a skill
  // split across files imports its siblings by bare name. Naming those as
  // missing dependencies sends the author looking for a package that is
  // already sitting next to the script.
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/beam.py": `"""Size a beam."""\nimport json\nimport material\nfrom limits import PHI\nimport matplotlib.pyplot as plt\n${BODY}${HARNESS}`,
    "scripts/limits.py": `"""Limits."""\nPHI = 0.9\n${BODY}${HARNESS}`,
    "scripts/material.py": `"""Material properties."""\n${BODY}${HARNESS}`,
  });
  const resolved = await resolveSkillScripts({
    declared: ["scripts/beam.py", "scripts/limits.py", "scripts/material.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.tools).toHaveLength(3);
  const reason =
    resolved.issues.find((i) => i.path === "scripts/beam.py")?.reason ?? "";
  expect(reason).toContain("matplotlib");
  expect(reason).not.toContain("material");
  expect(reason).not.toContain("limits");
  await rm(directory, { force: true, recursive: true });
});

test("a script that prints its result is accepted, not read as missing a harness", async () => {
  // print(json.dumps(...)) is how most Python reaches stdout. Requiring the
  // literal string sys.stdout refused working scripts and told their author
  // the harness was missing from a file that had one.
  const directory = await skillDir({
    "SKILL.md": "---\n---\n",
    "scripts/printed.py":
      `"""Printed result."""\n${BODY}\ndef run(input, context):\n    return {"w": hitung(input["b"], input["h"])}\n\n` +
      'if __name__ == "__main__":\n    import sys, json\n' +
      "    print(json.dumps(run(json.loads(sys.stdin.read() or '{}'), {})))\n",
  });
  const resolved = await resolveSkillScripts({
    declared: ["scripts/printed.py"],
    directory,
    skillName: "calc",
    toolPath: null,
  });

  expect(resolved.issues).toEqual([]);
  expect(resolved.tools).toHaveLength(1);
  await rm(directory, { force: true, recursive: true });
});
