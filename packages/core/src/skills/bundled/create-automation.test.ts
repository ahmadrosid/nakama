import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkillDirectory } from "../discover";
import { matchSkillsForMessage } from "../match";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("ensureBundledSkillFiles", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-bundled-skills-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("installs the create-plugin scaffold that writes a built draft", async () => {
    await ensureBundledSkillFiles();

    const skill = await discoverSkillDirectory(
      join(configDir, "agent", "skills", "create-plugin")
    );

    expect(skill).not.toBeNull();
    expect(skill?.scriptIssues).toEqual([]);
    expect(skill?.hasTool).toBe(false);
    const workspace = await mkdtemp(join(tmpdir(), "nakama-plugin-ws-"));

    const script = join(
      configDir,
      "agent",
      "skills",
      "create-plugin",
      "scripts",
      "new-plugin.mjs"
    );

    const run = Bun.spawnSync(
      ["bun", script, "standup-digest", "Standup Digest", "summarize"],
      { cwd: workspace }
    );

    expect(run.exitCode).toBe(0);

    const draft = join(workspace, "plugin-drafts", "standup-digest");

    const manifest = JSON.parse(
      await readFile(join(draft, "nakama.plugin.json"), "utf8")
    );

    expect(manifest.id).toBe("standup-digest");
    expect(manifest.actions[0].entry).toBe("actions/summarize.js");
    expect(manifest.ui.entryModule).toBe("ui/app.js");

    const page = await readFile(join(draft, "ui", "app.js"), "utf8");

    expect(page).toContain('[data-plugin-id="standup-digest"]');
    expect(page).not.toMatch(/from\s*"react/);
    expect(
      await Bun.file(join(draft, "actions", "summarize.js")).exists()
    ).toBe(true);

    const again = Bun.spawnSync(["bun", script, "standup-digest", "Again"], {
      cwd: workspace,
    });

    expect(again.exitCode).toBe(1);
  });

  test("the create-plugin data scaffold builds working list and save actions", async () => {
    await ensureBundledSkillFiles();

    const workspace = await mkdtemp(join(tmpdir(), "nakama-plugin-ws-"));

    const script = join(
      configDir,
      "agent",
      "skills",
      "create-plugin",
      "scripts",
      "new-plugin.mjs"
    );

    const run = Bun.spawnSync(
      ["bun", script, "book-log", "Book Log", "--data"],
      {
        cwd: workspace,
      }
    );

    expect(run.exitCode).toBe(0);

    const draft = join(workspace, "plugin-drafts", "book-log");

    const manifest = JSON.parse(
      await readFile(join(draft, "nakama.plugin.json"), "utf8")
    );

    expect(manifest.actions.map(({ key }: { key: string }) => key)).toEqual([
      "list_items",
      "save_item",
      "delete_item",
    ]);
    expect(await readdir(join(draft, "src"))).not.toContain("greet.js");

    const databasePath = join(draft, "test.sqlite");
    const db = new Database(databasePath);
    db.exec(
      await readFile(join(draft, manifest.database.migrations[0].path), "utf8")
    );
    db.close();

    const save = await import(join(draft, "actions", "save_item.js"));
    const list = await import(join(draft, "actions", "list_items.js"));
    const context = { databasePath };

    const { item } = await save.run({ name: "Dune", notes: "sci-fi" }, context);
    await save.run({ id: item.id, name: "Dune Messiah" }, context);
    await save.run({ name: "Emma" }, context);

    const all = await list.run({}, context);
    const found = await list.run({ query: "dune" }, context);

    expect(all.items).toHaveLength(2);
    expect(found.items.map(({ name }: { name: string }) => name)).toEqual([
      "Dune Messiah",
    ]);

    const remove = await import(join(draft, "actions", "delete_item.js"));
    await remove.run({ id: item.id }, context);

    const left = await list.run({}, context);

    expect(left.items.map(({ name }: { name: string }) => name)).toEqual([
      "Emma",
    ]);
    await expect(remove.run({ id: item.id }, context)).rejects.toThrow();

    const page = await readFile(join(draft, "ui", "app.js"), "utf8");

    expect(page).toContain('[data-plugin-id="book-log"]');
    expect(page).not.toMatch(/from\s*"react/);
  });

  test("does not overwrite existing skill files", async () => {
    const skillPath = join(
      configDir,
      "agent",
      "skills",
      "create-automation",
      "SKILL.md"
    );

    await mkdir(join(configDir, "agent", "skills", "create-automation"), {
      recursive: true,
    });
    await Bun.write(
      skillPath,
      "---\nname: create-automation\ndescription: custom\n---\n"
    );

    const created = await ensureBundledSkillFiles();

    expect(created).not.toContain("create-automation");
    expect(await readFile(skillPath, "utf8")).toContain("description: custom");
  });

  test("force-refreshes manage-skills even when an installed copy exists", async () => {
    const skillPath = join(
      configDir,
      "agent",
      "skills",
      "manage-skills",
      "SKILL.md"
    );

    await mkdir(join(configDir, "agent", "skills", "manage-skills"), {
      recursive: true,
    });
    await Bun.write(
      skillPath,
      "---\nname: manage-skills\ndescription: stale\n---\n"
    );

    const created = await ensureBundledSkillFiles();
    const content = await readFile(skillPath, "utf8");

    expect(created).toContain("manage-skills");
    expect(content).toContain("skill_manage");
    expect(content).not.toContain("description: stale");
  });

  test("refreshes an installed artifact-design skill on startup", async () => {
    const directory = join(configDir, "agent", "skills", "artifact-design");
    const skillPath = join(directory, "SKILL.md");
    await mkdir(directory, { recursive: true });
    await Bun.write(skillPath, "outdated bundled skill");

    const refreshed = await ensureBundledSkillFiles();

    expect(refreshed).toContain("artifact-design");
    expect(await readFile(skillPath, "utf8")).toBe(
      await readBundledSkillMarkdown("artifact-design")
    );
  });

  test("moves an installed save-artifact skill to artifact-design", async () => {
    const skillsDir = join(configDir, "agent", "skills");
    const legacyDir = join(skillsDir, "save-artifact");
    await mkdir(legacyDir, { recursive: true });
    await Bun.write(join(legacyDir, "SKILL.md"), "legacy skill");

    await ensureBundledSkillFiles();

    expect(await readdir(skillsDir)).not.toContain("save-artifact");
    expect(
      await readFile(join(skillsDir, "artifact-design", "SKILL.md"), "utf8")
    ).toBe(await readBundledSkillMarkdown("artifact-design"));
  });

  test("matches artifact-design for a casual slide deck request", async () => {
    await ensureBundledSkillFiles();

    const skill = await discoverSkillDirectory(
      join(configDir, "agent", "skills", "artifact-design")
    );

    expect(skill).not.toBeNull();

    const matched = matchSkillsForMessage(
      skill ? [skill] : [],
      "hey can you make me a slide deck for our team sync on friday? it's about Q3 results. keep it like 6-7 slides"
    );

    expect(matched.map((entry) => entry.name)).toEqual(["artifact-design"]);
  });

  test("refreshes an installed memory archive skill on startup", async () => {
    const directory = join(
      configDir,
      "agent",
      "skills",
      "archive-profile-memory"
    );

    const skillPath = join(directory, "SKILL.md");
    await mkdir(directory, { recursive: true });
    await Bun.write(skillPath, "outdated bundled skill");

    const refreshed = await ensureBundledSkillFiles();

    expect(refreshed).toContain("archive-profile-memory");
    expect(await readFile(skillPath, "utf8")).toBe(
      await readBundledSkillMarkdown("archive-profile-memory")
    );
  });
});
