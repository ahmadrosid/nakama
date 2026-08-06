import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathExists } from "../fs";
import {
  assertPathWithinProfileSkillsDir,
  assertSupportingFileAllowed,
  assertValidSkillName,
  composeSkillMarkdown,
  createSkillFile,
  deleteSkillDirectory,
  isPathWithinProfileSkillsDir,
  patchSkillFile,
  removeProfileSkillSupportingFile,
  resolveProfileSkillDirectory,
  resolveProfileSkillSupportingFilePath,
  writeProfileSkillSupportingFile,
  writeRawProfileSkillMarkdown,
} from "./write";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

describe("createSkillFile", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("writes a profile skill to ~/.nakama/orgs/{orgId}/profiles/{id}/skills/", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-write-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const directory = await createSkillFile({
      name: "weather",
      description: "Get weather forecasts. Use when the user asks about weather.",
      body: "Call the weather tool with a city name.",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    });

    expect(directory).toBe(
      join(configDir, "orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "weather"),
    );

    const content = await readFile(join(directory, "SKILL.md"), "utf8");
    expect(content).toContain("name: weather");
    expect(content).toContain("Call the weather tool");
  });

  test("composeSkillMarkdown includes disable-model-invocation when set", () => {
    const content = composeSkillMarkdown({
      name: "deploy",
      description: "Deploy the app.",
      disableModelInvocation: true,
    });

    expect(content).toContain("disable-model-invocation: true");
  });

  test("deleteSkillDirectory removes a managed profile skill directory", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-write-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const directory = await createSkillFile({
      name: "notes",
      description: "Capture notes for the user.",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    });

    await deleteSkillDirectory(directory);

    expect(await pathExists(directory)).toBe(false);
  });
});

describe("assertValidSkillName", () => {
  test("accepts kebab-case names", () => {
    expect(assertValidSkillName("research-paper")).toBe("research-paper");
  });

  test("rejects path traversal and invalid characters", () => {
    expect(() => assertValidSkillName("../escape")).toThrow(/lowercase/);
    expect(() => assertValidSkillName("Bad_Name")).toThrow(/lowercase/);
    expect(() => assertValidSkillName("a".repeat(65))).toThrow(/lowercase/);
  });
});

describe("writeRawProfileSkillMarkdown", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("writes raw SKILL.md preserving include-body-on-match", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-raw-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const content = `---
name: research-paper
description: Research papers end to end.
include-body-on-match: true
---

1. Search.
2. Summarize.
`;

    const result = await writeRawProfileSkillMarkdown({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      content,
    });

    expect(result.created).toBe(true);
    expect(result.name).toBe("research-paper");
    const onDisk = await readFile(join(result.directory, "SKILL.md"), "utf8");
    expect(onDisk).toContain("include-body-on-match: true");
    expect(onDisk).toContain("1. Search.");
  });

  test("adopts existing valid skill directory when allowExisting", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-adopt-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const directory = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "orphan",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      `---
name: orphan
description: Leftover from write_file.
include-body-on-match: true
---

Old body.
`,
      "utf8",
    );

    const result = await writeRawProfileSkillMarkdown({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      content: `---
name: orphan
description: Leftover from write_file.
include-body-on-match: true
---

Old body.
`,
      allowExisting: true,
    });

    expect(result.created).toBe(false);
    expect(result.directory).toBe(realpathSync(directory));
  });

  test("refuses bundled skill names", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-bundled-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await expect(
      writeRawProfileSkillMarkdown({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        content: `---
name: manage-skills
description: Should not overwrite bundled.
---

Nope.
`,
      }),
    ).rejects.toThrow(/bundled/i);
  });

  test("refuses existing skill without allowExisting", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-exists-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const content = `---
name: dup
description: First write.
---

Body.
`;
    await writeRawProfileSkillMarkdown({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      content,
    });

    await expect(
      writeRawProfileSkillMarkdown({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        content,
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("patchSkillFile", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("applies unique old_string replacement and re-validates", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-patch-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await writeRawProfileSkillMarkdown({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      content: `---
name: deploy
description: Deploy the service.
include-body-on-match: true
---

Use staging first.
`,
    });

    const result = await patchSkillFile({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      name: "deploy",
      oldString: "Use staging first.",
      newString: "Use staging first.\nThen promote to prod.",
    });

    expect(result.name).toBe("deploy");
    const onDisk = await readFile(join(result.directory, "SKILL.md"), "utf8");
    expect(onDisk).toContain("Then promote to prod.");
    expect(onDisk).toContain("include-body-on-match: true");
  });

  test("errors when old_string is missing or duplicated", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-patch-err-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await writeRawProfileSkillMarkdown({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      content: `---
name: repeat
description: Repeat steps.
---

step
step
`,
    });

    await expect(
      patchSkillFile({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        name: "repeat",
        oldString: "missing",
        newString: "x",
      }),
    ).rejects.toThrow(/not found|missing/i);

    await expect(
      patchSkillFile({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        name: "repeat",
        oldString: "step",
        newString: "done",
      }),
    ).rejects.toThrow(/multiple|duplicate/i);
  });

  test("refuses patch on bundled skill name", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-patch-bundled-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await expect(
      patchSkillFile({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        name: "manage-skills",
        oldString: "a",
        newString: "b",
      }),
    ).rejects.toThrow(/bundled/i);
  });
});

describe("resolveProfileSkillDirectory", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("resolves under profile skills dir and rejects escape names", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-resolve-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "orgs", ORG_ID, "profiles", PROFILE_ID, "skills"), {
      recursive: true,
    });

    expect(resolveProfileSkillDirectory(ORG_ID, PROFILE_ID, "ok-skill")).toBe(
      join(
        realpathSync(configDir),
        "orgs",
        ORG_ID,
        "profiles",
        PROFILE_ID,
        "skills",
        "ok-skill",
      ),
    );

    expect(() => resolveProfileSkillDirectory(ORG_ID, PROFILE_ID, "../x")).toThrow();
  });

  test("refuses symlink escape outside the profile skills dir", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-symlink-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const skillsRoot = join(configDir, "orgs", ORG_ID, "profiles", PROFILE_ID, "skills");
    const outside = join(configDir, "outside-secret");
    await mkdir(skillsRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "SKILL.md"), "---\nname: leaked\ndescription: x\n---\n");
    await symlink(outside, join(skillsRoot, "leaked"));

    expect(isPathWithinProfileSkillsDir(ORG_ID, PROFILE_ID, join(skillsRoot, "leaked"))).toBe(
      false,
    );
    expect(() =>
      assertPathWithinProfileSkillsDir(ORG_ID, PROFILE_ID, join(skillsRoot, "leaked", "SKILL.md")),
    ).toThrow(/outside the profile skills directory/);
  });
});

describe("profile skill supporting files", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("writes nested supporting files and refuses SKILL.md / path escape", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-support-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await writeRawProfileSkillMarkdown({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      content: `---
name: deploy
description: Deploy the service.
---

Use staging first.
`,
    });

    expect(() => assertSupportingFileAllowed("/tmp/skills/demo/SKILL.md")).toThrow();
    expect(() => assertSupportingFileAllowed("/tmp/skills/demo/Tool.js")).toThrow();
    expect(() => assertSupportingFileAllowed("/tmp/skills/demo/skill.md")).toThrow();
    expect(() =>
      resolveProfileSkillSupportingFilePath(ORG_ID, PROFILE_ID, "deploy", "../escape.md"),
    ).toThrow();

    const skillDir = resolveProfileSkillDirectory(ORG_ID, PROFILE_ID, "deploy");
    const outside = join(configDir, "outside.txt");
    const symlinkPath = join(skillDir, "sidecar.md");
    await symlink(outside, symlinkPath);
    await expect(
      writeProfileSkillSupportingFile({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        name: "deploy",
        relativePath: "sidecar.md",
        content: "ESCAPED\n",
      }),
    ).rejects.toThrow(/symbolic link/i);
    expect(await pathExists(outside)).toBe(false);

    const written = await writeProfileSkillSupportingFile({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      name: "deploy",
      relativePath: "docs/checklist.md",
      content: "- staging\n",
    });
    expect(written.relativePath).toBe("docs/checklist.md");
    expect(await readFile(written.absolutePath, "utf8")).toContain("- staging");

    await removeProfileSkillSupportingFile({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      name: "deploy",
      relativePath: "docs/checklist.md",
    });
    expect(await pathExists(written.absolutePath)).toBe(false);
  });
});
