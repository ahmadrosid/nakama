import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convertDocxToMarkdown } from "../docx-text";
import {
  PathGuardError,
  runDeleteFile,
  runEditFile,
  runReadFile,
  runWriteDocx,
  runWriteFile,
  setDefaultFileGuardOptions,
} from "./builtin";

const PROFILE_CONTEXT = { orgId: "org_test", profileId: "profile_test" };
const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

describe("file builtin tools", () => {
  let tempDir = "";
  let configDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
      tempDir = "";
    }
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
    setDefaultFileGuardOptions({});
  });

  test("write_file creates nested files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-write-"));
    const targetPath = path.join(tempDir, "nested", "hello.txt");

    const result = await runWriteFile(
      { content: "hello world", path: targetPath },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(await realpath(targetPath));
    expect(result.bytesWritten).toBe(11);
    expect(await readFile(targetPath, "utf8")).toBe("hello world");
  });

  test("write_file resolves relative paths from profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-write-"));
    const result = await runWriteFile(
      { content: "relative", path: "notes.txt" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(path.join(await realpath(tempDir), "notes.txt"));
    expect(await readFile(result.path, "utf8")).toBe("relative");
  });

  test("write_file adds a date suffix when an artifact filename already exists", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-write-"));
    const artifactsDir = path.join(tempDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const existingPath = path.join(artifactsDir, "report.md");
    await writeFile(existingPath, "existing", "utf8");
    const dateSuffix = new Date().toISOString().slice(0, 10);

    const result = await runWriteFile(
      { content: "new report", path: "artifacts/report.md" },
      { ...PROFILE_CONTEXT, sessionId: "session_suffix" },
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(
      path.join(await realpath(artifactsDir), `report-${dateSuffix}.md`)
    );
    expect(await readFile(existingPath, "utf8")).toBe("existing");
    expect(await readFile(result.path, "utf8")).toBe("new report");
  });

  test("write_file remaps artifact metadata sidecar after suffixing content", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-write-"));
    const artifactsDir = path.join(tempDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const existingPath = path.join(artifactsDir, "report.md");
    await writeFile(existingPath, "existing", "utf8");
    const dateSuffix = new Date().toISOString().slice(0, 10);

    const context = { ...PROFILE_CONTEXT, sessionId: "session_meta_suffix" };

    const contentResult = await runWriteFile(
      { content: "new report", path: "artifacts/report.md" },
      context,
      { workspaceRoot: tempDir }
    );

    const metaResult = await runWriteFile(
      {
        content: JSON.stringify({
          mimeType: "text/markdown",
          savedAt: "2026-07-14T12:00:00.000Z",
          sizeBytes: 10,
        }),
        path: "artifacts/report.md.nakama-meta.json",
      },
      context,
      { workspaceRoot: tempDir }
    );

    expect(contentResult.path).toBe(
      path.join(await realpath(artifactsDir), `report-${dateSuffix}.md`)
    );
    expect(metaResult.path).toBe(
      path.join(
        await realpath(artifactsDir),
        `report-${dateSuffix}.md.nakama-meta.json`
      )
    );
  });

  test("write_file allows custom tool modules outside profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-write-"));
    configDir = await mkdtemp(path.join(os.tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const toolsDir = path.join(configDir, "tools");
    await mkdir(toolsDir, { recursive: true });

    const targetPath = path.join(toolsDir, "echo.js");
    const result = await runWriteFile(
      {
        content: "export async function run() { return null; }",
        path: targetPath,
      },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(await realpath(targetPath));
    expect(await readFile(targetPath, "utf8")).toContain(
      "export async function run"
    );
  });

  test("delete_file removes a file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-delete-"));
    const targetPath = path.join(tempDir, "remove-me.txt");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "temp", "utf8");
    const resolvedTargetPath = await realpath(targetPath);

    const result = await runDeleteFile({ path: targetPath }, PROFILE_CONTEXT, {
      workspaceRoot: tempDir,
    });

    expect(result).toEqual({ deleted: true, path: resolvedTargetPath });
    await expect(readFile(targetPath, "utf8")).rejects.toThrow();
  });

  test("edit_file replaces a unique text match", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "hello old world", "utf8");

    const result = await runEditFile(
      { edits: [{ newText: "new", oldText: "old" }], path: targetPath },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(await realpath(targetPath));
    expect(result.replacements).toBe(1);
    expect(result.fuzzyMatches).toBe(0);
    expect(await readFile(targetPath, "utf8")).toBe("hello new world");
  });

  test("edit_file resolves relative paths from profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    await writeFile(path.join(tempDir, "note.txt"), "relative old", "utf8");

    const result = await runEditFile(
      { edits: [{ newText: "new", oldText: "old" }], path: "note.txt" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(path.join(await realpath(tempDir), "note.txt"));
    expect(await readFile(result.path, "utf8")).toBe("relative new");
  });

  test("edit_file applies multiple edits against the original file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "one two three", "utf8");

    const result = await runEditFile(
      {
        edits: [
          { newText: "two", oldText: "one" },
          { newText: "one", oldText: "three" },
        ],
        path: targetPath,
      },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.replacements).toBe(2);
    expect(await readFile(targetPath, "utf8")).toBe("two two one");
  });

  test("edit_file rejects ambiguous matches", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "old and old", "utf8");

    await expect(
      runEditFile(
        { edits: [{ newText: "new", oldText: "old" }], path: targetPath },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow("ambiguous");
    expect(await readFile(targetPath, "utf8")).toBe("old and old");
  });

  test("edit_file rejects overlapping edits", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "abcdef", "utf8");

    await expect(
      runEditFile(
        {
          edits: [
            { newText: "ABC", oldText: "abc" },
            { newText: "BCD", oldText: "bcd" },
          ],
          path: targetPath,
        },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow("overlaps");
    expect(await readFile(targetPath, "utf8")).toBe("abcdef");
  });

  test("edit_file fuzzy matches line endings and smart punctuation", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(
      targetPath,
      "before\r\nsay “hello”—now\r\nafter\r\n",
      "utf8"
    );

    const result = await runEditFile(
      {
        edits: [{ newText: "say goodbye", oldText: 'say "hello"-now' }],
        path: targetPath,
      },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.fuzzyMatches).toBe(1);
    expect(await readFile(targetPath, "utf8")).toBe(
      "before\r\nsay goodbye\r\nafter\r\n"
    );
  });

  test("edit_file preserves CRLF style in replacement text", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "before\r\nold block\r\nafter\r\n", "utf8");

    await runEditFile(
      {
        edits: [{ newText: "new\nblock", oldText: "old block" }],
        path: targetPath,
      },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(await readFile(targetPath, "utf8")).toBe(
      "before\r\nnew\r\nblock\r\nafter\r\n"
    );
  });

  test("edit_file fuzzy matching ignores trailing whitespace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "alpha  \nbeta\n", "utf8");

    const result = await runEditFile(
      {
        edits: [{ newText: "ALPHA\nbeta", oldText: "alpha\nbeta" }],
        path: targetPath,
      },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.fuzzyMatches).toBe(1);
    expect(await readFile(targetPath, "utf8")).toBe("ALPHA\nbeta\n");
  });

  test("edit_file preserves a UTF-8 BOM", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "\uFEFFhello old", "utf8");

    await runEditFile(
      { edits: [{ newText: "new", oldText: "old" }], path: targetPath },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    const result = await readFile(targetPath);
    expect(result.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(result.toString("utf8")).toBe("\uFEFFhello new");
  });

  test("edit_file rejects missing oldText", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-edit-"));
    const targetPath = path.join(tempDir, "note.txt");
    await writeFile(targetPath, "hello", "utf8");

    await expect(
      runEditFile(
        { edits: [{ newText: "new", oldText: "missing" }], path: targetPath },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow("oldText not found");
  });

  test("read_file reads an existing file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    const targetPath = path.join(tempDir, "sample.txt");
    await writeFile(targetPath, "hello world", "utf8");

    const result = await runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
      workspaceRoot: tempDir,
    });

    expect(result.path).toBe(await realpath(targetPath));
    expect(result.content).toBe("hello world");
    expect(result.bytesRead).toBe(11);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(1);
    expect(result.totalLines).toBe(1);
    expect(result.truncated).toBe(false);
  });

  test("write_file refuses Word extensions instead of faking a document", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-write-"));

    expect(
      runWriteFile(
        {
          content: "<html><body>hi</body></html>",
          path: path.join(tempDir, "laporan.docx"),
        },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/write_docx/);

    expect(
      runWriteFile(
        {
          content: "<html><body>hi</body></html>",
          path: path.join(tempDir, "laporan.doc"),
        },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/write_docx/);
  });

  test("file tools refuse skills/* paths when forbidProfileSkillMarkdownWrites", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-skill-md-"));
    await mkdir(path.join(tempDir, "skills", "notes", "docs"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempDir, "skills", "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Notes.\n---\n\nBody.\n",
      "utf8"
    );
    await writeFile(
      path.join(tempDir, "skills", "notes", "docs", "notes.md"),
      "nested\n",
      "utf8"
    );
    const context = {
      ...PROFILE_CONTEXT,
      forbidProfileSkillMarkdownWrites: true,
    };

    await expect(
      runWriteFile(
        {
          content: "---\nname: notes\ndescription: x\n---\n",
          path: "skills/notes/SKILL.md",
        },
        context,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/Use skill_manage/);

    await expect(
      runWriteFile(
        { content: "changed", path: "skills/notes/docs/notes.md" },
        context,
        {
          workspaceRoot: tempDir,
        }
      )
    ).rejects.toThrow(/Use skill_manage/);

    await expect(
      runEditFile(
        {
          edits: [{ newText: "changed", oldText: "nested" }],
          path: "skills/notes/docs/notes.md",
        },
        context,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/Use skill_manage/);

    await expect(
      runDeleteFile({ path: "skills/notes/docs/notes.md" }, context, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(/Use skill_manage/);

    await expect(
      runWriteDocx(
        { markdown: "# hi", path: "skills/notes/notes.docx" },
        context,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/Use skill_manage/);

    expect(
      await readFile(
        path.join(tempDir, "skills", "notes", "docs", "notes.md"),
        "utf8"
      )
    ).toBe("nested\n");
  });

  test("write_file, edit_file, and delete_file refuse skills/*/tool.js and tool.ts", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-skill-tool-"));
    await mkdir(path.join(tempDir, "skills", "notes"), { recursive: true });

    await expect(
      runWriteFile(
        { content: "export default {};", path: "skills/notes/tool.js" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/tool\.js.*Phase 1/);

    await expect(
      runWriteFile(
        { content: "export default {};", path: "skills/notes/tool.ts" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/tool\.ts.*Phase 1/);

    await writeFile(
      path.join(tempDir, "skills", "notes", "tool.js"),
      "export default {};",
      "utf8"
    );

    await expect(
      runEditFile(
        {
          edits: [
            {
              newText: "export default { x: 1 };",
              oldText: "export default {};",
            },
          ],
          path: "skills/notes/tool.js",
        },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/tool\.js.*Phase 1/);

    await expect(
      runDeleteFile({ path: "skills/notes/tool.js" }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(/tool\.js.*Phase 1/);
  });

  test("write_docx produces a real Word archive that reads back as markdown", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-docx-"));
    const targetPath = path.join(tempDir, "laporan.docx");

    const result = await runWriteDocx(
      {
        markdown:
          "# Laporan\n\nSkor **79** dari 100.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n",
        path: targetPath,
      },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    const bytes = await readFile(result.path);
    // A real .docx is a ZIP archive: local file header magic `PK\x03\x04`.
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");

    const markdown = await convertDocxToMarkdown(bytes);
    expect(markdown).toContain("# Laporan");
    expect(markdown).toContain("**79**");
    expect(markdown).toContain("| 1");
  });

  test("write_docx does not overwrite an existing artifact", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-docx-"));
    await mkdir(path.join(tempDir, "artifacts"), { recursive: true });

    const first = await runWriteDocx(
      { markdown: "# Pertama", path: "artifacts/laporan.docx" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );
    const second = await runWriteDocx(
      { markdown: "# Kedua", path: "artifacts/laporan.docx" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(second.path).not.toBe(first.path);
    expect(path.basename(second.path)).toMatch(
      /^laporan-\d{4}-\d{2}-\d{2}\.docx$/
    );
    expect(await convertDocxToMarkdown(await readFile(first.path))).toContain(
      "# Pertama"
    );
    expect(await convertDocxToMarkdown(await readFile(second.path))).toContain(
      "# Kedua"
    );
  });

  test("write_docx rejects a non-.docx path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-docx-"));

    expect(
      runWriteDocx(
        { markdown: "# Hi", path: path.join(tempDir, "laporan.txt") },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(/\.docx/);
  });

  test("read_file converts a .docx to markdown instead of decoding it as utf-8", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    const targetPath = path.join(tempDir, "laporan.docx");
    await copyFile(
      path.join(import.meta.dir, "..", "__fixtures__", "sample.docx"),
      targetPath
    );

    const result = await runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
      workspaceRoot: tempDir,
    });

    expect(result.content).toContain("Laporan Mingguan");
    expect(result.content).toContain("**teks tebal**");
  });

  test("read_file reads HTML that was saved under a .doc name", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    const targetPath = path.join(tempDir, "lama.doc");
    await writeFile(
      targetPath,
      "<html><head><style>body { color: #333; }</style></head><body><h1>Judul</h1></body></html>",
      "utf8"
    );

    const result = await runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
      workspaceRoot: tempDir,
    });

    expect(result.content).toContain("# Judul");
    expect(result.content).not.toContain("color: #333");
  });

  test("read_file rejects a genuine legacy OLE .doc with an actionable message", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    const targetPath = path.join(tempDir, "lama.doc");
    // OLE compound file magic: a real Word 97-2003 document.
    await writeFile(
      targetPath,
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );

    expect(
      runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(/Convert the file to \.docx/);
  });

  test("read_file resolves relative paths from profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    await writeFile(path.join(tempDir, "notes.txt"), "relative", "utf8");

    const result = await runReadFile({ path: "notes.txt" }, PROFILE_CONTEXT, {
      workspaceRoot: tempDir,
    });

    expect(result.path).toBe(path.join(await realpath(tempDir), "notes.txt"));
    expect(result.content).toBe("relative");
  });

  test("read_file allows custom tool modules outside profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    configDir = await mkdtemp(path.join(os.tmpdir(), "nakama-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const toolsDir = path.join(configDir, "tools");
    await mkdir(toolsDir, { recursive: true });

    const targetPath = path.join(toolsDir, "echo.js");
    await writeFile(targetPath, "export async function run() {}", "utf8");

    const result = await runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
      workspaceRoot: tempDir,
    });

    expect(result.path).toBe(await realpath(targetPath));
    expect(result.content).toContain("export async function run");
  });

  test("read_file supports offset and limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-"));
    const targetPath = path.join(tempDir, "lines.txt");
    await writeFile(targetPath, "one\ntwo\nthree\nfour", "utf8");

    const result = await runReadFile(
      { limit: 2, offset: 2, path: targetPath },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.content).toBe("two\nthree");
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
    expect(result.totalLines).toBe(4);
    expect(result.truncated).toBe(true);
  });

  test("requires profileId", async () => {
    await expect(
      runWriteFile({ content: "x", path: "a.txt" }, {})
    ).rejects.toThrow("orgId and profileId are required.");
    await expect(runReadFile({ path: "a.txt" }, {})).rejects.toThrow(
      "orgId and profileId are required."
    );
    await expect(
      runEditFile(
        { edits: [{ newText: "y", oldText: "x" }], path: "a.txt" },
        {}
      )
    ).rejects.toThrow("orgId and profileId are required.");
  });

  // -----------------------------------------------------------------------
  // Security tests
  // -----------------------------------------------------------------------

  test("rejects path traversal via ../ escape", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));
    const escapePath = path.join(tempDir, "../../../etc/nakama-exploit-test");

    await expect(
      runWriteFile({ content: "ESCAPE", path: escapePath }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(PathGuardError);
  });

  test("rejects absolute path outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    await expect(
      runWriteFile(
        { content: "NOPE", path: "/etc/nakama-should-fail" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("rejects home directory expansion outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    await expect(
      runWriteFile(
        { content: "SSH_KEY", path: "~/.ssh/nakama-test" },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("cwd injection falls back to profile workspace", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    const result = await runWriteFile(
      { content: "OK", cwd: "/etc", path: "safe.txt" },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toStartWith(await realpath(tempDir));
  });

  test("rejects null byte in path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    await expect(
      runWriteFile(
        { content: "X", path: path.join(tempDir, "safe.txt\0.sh") },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("rejects content exceeding max file size", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));
    setDefaultFileGuardOptions({ maxFileBytes: 100 });

    await expect(
      runWriteFile(
        { content: "A".repeat(200), path: path.join(tempDir, "big.txt") },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("delete_file rejects path outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    await expect(
      runDeleteFile({ path: "/etc/should-not-delete" }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(PathGuardError);
  });

  test("edit_file rejects path outside allowed dirs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    await expect(
      runEditFile(
        {
          edits: [{ newText: "y", oldText: "x" }],
          path: "/etc/nakama-should-fail",
        },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("edit_file rejects oversized replacement result", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));
    setDefaultFileGuardOptions({ maxFileBytes: 100 });
    const targetPath = path.join(tempDir, "small.txt");
    await writeFile(targetPath, "small", "utf8");

    await expect(
      runEditFile(
        {
          edits: [{ newText: "A".repeat(200), oldText: "small" }],
          path: targetPath,
        },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("allows nested subdirectory writes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    const nestedPath = path.join(tempDir, "deep", "nested", "file.txt");
    const result = await runWriteFile(
      { content: "deep", path: nestedPath },
      PROFILE_CONTEXT,
      { workspaceRoot: tempDir }
    );

    expect(result.path).toBe(await realpath(nestedPath));
    expect(await readFile(nestedPath, "utf8")).toBe("deep");
  });

  test("rejects special filesystem paths", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-sec-"));

    await expect(
      runWriteFile({ content: "test", path: "/dev/null" }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(PathGuardError);
  });

  test("read_file rejects path traversal via ../ escape", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));
    const escapePath = path.join(tempDir, "../../../etc/nakama-exploit-test");

    await expect(
      runReadFile({ path: escapePath }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(PathGuardError);
  });

  test("read_file rejects path outside allowed dirs with workspace hint", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));

    await expect(
      runReadFile({ path: "/etc/nakama-should-fail" }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(/relative path under the active profile workspace/i);
  });

  test("read_file rejects null byte in path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));

    await expect(
      runReadFile(
        { path: path.join(tempDir, "safe.txt\0.sh") },
        PROFILE_CONTEXT,
        { workspaceRoot: tempDir }
      )
    ).rejects.toThrow(PathGuardError);
  });

  test("read_file rejects missing file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));

    await expect(
      runReadFile(
        { path: path.join(tempDir, "missing.txt") },
        PROFILE_CONTEXT,
        {
          workspaceRoot: tempDir,
        }
      )
    ).rejects.toThrow("File not found");
  });

  test("read_file rejects directory path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));

    await expect(
      runReadFile({ path: tempDir }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow("Path is not a file");
  });

  test("read_file rejects config.ini", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));
    const targetPath = path.join(tempDir, "config.ini");
    await writeFile(targetPath, "secret=value", "utf8");

    await expect(
      runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(PathGuardError);
  });

  test("read_file rejects oversized file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-read-sec-"));
    setDefaultFileGuardOptions({ maxFileBytes: 100 });
    const targetPath = path.join(tempDir, "big.txt");
    await writeFile(targetPath, "A".repeat(200), "utf8");

    await expect(
      runReadFile({ path: targetPath }, PROFILE_CONTEXT, {
        workspaceRoot: tempDir,
      })
    ).rejects.toThrow(PathGuardError);
  });
});
