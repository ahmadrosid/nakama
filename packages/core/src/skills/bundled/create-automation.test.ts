import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkillDirectory } from "../discover";
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

  test("the create-plugin charts scaffold adds charts that pass the page checks", async () => {
    await ensureBundledSkillFiles();

    const workspace = await mkdtemp(join(tmpdir(), "nakama-plugin-ws-"));

    const scripts = join(
      configDir,
      "agent",
      "skills",
      "create-plugin",
      "scripts"
    );

    const draft = join(workspace, "plugin-drafts", "price-board");

    const run = (script: string, ...args: string[]) =>
      Bun.spawnSync(["bun", join(scripts, script), ...args], {
        cwd: workspace,
      });

    expect(
      run("new-plugin.mjs", "price-board", "Price Board", "--charts").exitCode
    ).toBe(0);

    const pagePath = join(draft, "src", "ui.jsx");
    const page = await readFile(pagePath, "utf8");

    await Bun.write(
      pagePath,
      page
        .replace(
          'import css from "./ui.css" with { type: "text" };',
          'import css from "./ui.css" with { type: "text" };\nimport { createCharts } from "./charts.jsx";'
        )
        .replace(
          "ctx.styles(css);",
          'ctx.styles(css);\n  const { LineChart } = createCharts(ctx);\n  const Trend = () => <LineChart data={[]} />;\n  ctx.slots.register("tool:trend", Trend);'
        )
    );

    const manifestPath = join(draft, "nakama.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.description = "Track prices.";
    manifest.actions[0].description = "Read prices.";
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

    expect(run("build-plugin.mjs", "price-board").exitCode).toBe(0);
    expect(await readFile(join(draft, "ui", "app.js"), "utf8")).toContain(
      'data-plugin-id="price-board"'
    );
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

  test("build-plugin passes a finished draft and lists each problem in a broken one", async () => {
    await ensureBundledSkillFiles();

    const workspace = await mkdtemp(join(tmpdir(), "nakama-plugin-ws-"));

    const scripts = join(
      configDir,
      "agent",
      "skills",
      "create-plugin",
      "scripts"
    );

    const draft = join(workspace, "plugin-drafts", "task-hub");

    const run = (script: string, ...args: string[]) =>
      Bun.spawnSync(["bun", join(scripts, script), ...args], {
        cwd: workspace,
      });

    expect(
      run("new-plugin.mjs", "task-hub", "Task Hub", "list_tasks").exitCode
    ).toBe(0);

    const manifestPath = join(draft, "nakama.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.description = "List my open tasks.";
    manifest.actions[0].description = "List open tasks.";
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
    await Bun.write(join(draft, "actions", "list_tasks.js"), "");
    // A bundle left behind by a renamed action.
    await Bun.write(join(draft, "actions", "old_action.js"), "");

    const passed = run("build-plugin.mjs", "task-hub");

    expect(passed.exitCode).toBe(0);
    // The build rewrote the emptied bundle from src/ and dropped the stale one.
    expect(
      await readFile(join(draft, "actions", "list_tasks.js"), "utf8")
    ).toContain("run");
    expect(await readdir(join(draft, "actions"))).toEqual(["list_tasks.js"]);

    manifest.actions[0].inputSchema.properties.name.default = "me";
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

    const pagePath = join(draft, "src", "ui.jsx");
    const page = await readFile(pagePath, "utf8");
    await Bun.write(
      pagePath,
      page.replace(
        "<Card>",
        "<h1>Tasks</h1><Table><TableBody><TableRow><TableCell><Button>Close</Button></TableCell></TableRow></TableBody></Table><Card>"
      )
    );
    await Bun.write(
      join(draft, "src", "ui.css"),
      `${await readFile(join(draft, "src", "ui.css"), "utf8")}\n.loose { color: #fff; }\n`
    );

    const broken = run("build-plugin.mjs", "task-hub");

    const problems = broken.stderr
      .toString()
      .split("\n")
      .filter((line) => line.startsWith("- "));

    expect(broken.exitCode).toBe(1);
    // Schema keyword, heading, button column, unscoped rule, and hex color.
    expect(problems).toHaveLength(5);

    await Bun.write(manifestPath, '{\n  "id": "task-hub",,\n}');

    expect(run("build-plugin.mjs", "task-hub").exitCode).toBe(1);
  });

  test("build-plugin reports bad lists, shared sources, and unscoped @media rules without crashing", async () => {
    await ensureBundledSkillFiles();

    const workspace = await mkdtemp(join(tmpdir(), "nakama-plugin-ws-"));

    const scripts = join(
      configDir,
      "agent",
      "skills",
      "create-plugin",
      "scripts"
    );

    const draft = join(workspace, "plugin-drafts", "task-hub");

    const run = (script: string, ...args: string[]) =>
      Bun.spawnSync(["bun", join(scripts, script), ...args], {
        cwd: workspace,
      });

    expect(
      run("new-plugin.mjs", "task-hub", "Task Hub", "list_tasks").exitCode
    ).toBe(0);

    const manifestPath = join(draft, "nakama.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    // A real description may end in "plugin."; only the template text fails.
    manifest.description = "Show tasks from the Jira plugin.";
    manifest.actions[0].description = "List open tasks.";
    manifest.actions[0].inputSchema.required = [];
    manifest.skills = [null];
    manifest.workers = [
      { entry: "workers/list_tasks.js", key: "sync", name: "Sync" },
    ];
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

    await Bun.write(
      join(draft, "src", "ui.css"),
      `${await readFile(join(draft, "src", "ui.css"), "utf8")}\n@media (max-width: 600px) { .row { display: none; } }\n`
    );

    const broken = run("build-plugin.mjs", "task-hub");
    const stderr = broken.stderr.toString();

    expect(broken.exitCode).toBe(1);
    expect(stderr).not.toContain("TypeError");
    // The null skill, the worker sharing src/list_tasks, and the @media rule.
    expect(
      stderr.split("\n").filter((line) => line.startsWith("- "))
    ).toHaveLength(3);

    await Bun.write(manifestPath, "null");

    const empty = run("build-plugin.mjs", "task-hub");

    expect(empty.exitCode).toBe(1);
  });

  test("build-plugin accepts and rejects the same manifests as the host", async () => {
    const { validatePluginManifest } = await import("../../plugins");

    const scriptPath = join(
      import.meta.dir,
      "create-plugin",
      "scripts",
      "build-plugin.mjs"
    );

    const schemas = [
      { properties: {}, required: [], type: "object" },
      {
        properties: { q: { type: "string" } },
        required: ["q"],
        type: "object",
      },
      { properties: { q: { default: "", type: "string" } }, type: "object" },
      { enum: [], type: "string" },
      { type: "date" },
    ];

    const manifests = schemas.map((inputSchema) => ({
      actions: [
        {
          access: "member",
          description: "List tasks.",
          effect: "read",
          entry: "actions/list.js",
          inputSchema,
          key: "list",
        },
      ],
      apiVersion: 1,
      author: "Team",
      description: "Track tasks.",
      id: "task-hub",
      license: "MIT",
      minNakamaVersion: "0.4.47",
      name: "Task Hub",
      version: "1.0.0",
    }));

    // SAFETY: The script exports checkManifest; this test pins its shape.
    const { checkManifest } = (await import(scriptPath)) as {
      checkManifest: (
        manifest: (typeof manifests)[number],
        packageJson: { type: string; version: string },
        draftId: string
      ) => string[];
    };

    for (const value of manifests) {
      const host = validatePluginManifest(value).ok;

      const script =
        checkManifest(value, { type: "module", version: "1.0.0" }, "task-hub")
          .length === 0;

      expect({ schema: value.actions[0]?.inputSchema, script }).toEqual({
        schema: value.actions[0]?.inputSchema,
        script: host,
      });
    }
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

  test("installs the slide deck template and patterns beside the skill", async () => {
    await ensureBundledSkillFiles();

    const assets = join(
      configDir,
      "agent",
      "skills",
      "slide-deck-design",
      "assets"
    );

    const template = await readFile(join(assets, "deck.html"), "utf8");
    const patternFiles = await readdir(join(assets, "patterns"));

    expect(template).toContain('class="slide"');
    expect(patternFiles.length).toBeGreaterThan(0);

    for (const file of patternFiles) {
      expect(await readFile(join(assets, "patterns", file), "utf8")).toContain(
        'class="slide'
      );
    }
  });
});
