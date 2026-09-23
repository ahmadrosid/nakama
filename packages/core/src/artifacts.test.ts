import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listArtifacts,
  listWorkspaceFiles,
  readArtifactFile,
  readWorkspaceFile,
  renameWorkspaceEntry,
  writeArtifactFile,
} from "./artifacts";
import {
  getAppUserSoulDir,
  getProfileArtifactsDir,
  getProfileSoulDir,
} from "./soul/resolve";

const SAMPLE_DOCX_PATH = path.join(
  import.meta.dir,
  "__fixtures__",
  "sample.docx"
);

const ORG_ID = "org_test";
const PROFILE_ID = "profile_test";

test("workspace rename preserves files, folder contents and sidecars, and rolls back failed reference updates", async () => {
  await writeArtifact("notes/report.md", "report");
  await writeArtifact(
    "notes/report.md.nakama-meta.json",
    JSON.stringify({
      mimeType: "text/markdown",
      savedAt: "2026-09-20T00:00:00.000Z",
      sizeBytes: 6,
    })
  );
  const references: string[] = [];
  const rename = (
    filename: string,
    newName: string,
    updateReferences = async (next: string) => {
      references.push(next);
    }
  ) =>
    renameWorkspaceEntry({
      newName,
      orgId: ORG_ID,
      path: filename,
      profileId: PROFILE_ID,
      updateReferences,
    });
  const entry = await rename("artifacts/notes/report.md", "summary.md");
  expect(entry.path).toBe("artifacts/notes/summary.md");
  expect((await listArtifacts(ORG_ID, PROFILE_ID)).artifacts[0]).toMatchObject({
    filename: "notes/summary.md",
    mimeType: "text/markdown",
    updatedAt: "2026-09-20T00:00:00.000Z",
  });
  await rename("artifacts/notes", "drafts");
  expect(
    (await readWorkspaceFile(ORG_ID, PROFILE_ID, "artifacts/drafts/summary.md"))
      .entry.kind
  ).toBe("file");
  expect(references).toEqual([
    "artifacts/notes/summary.md",
    "artifacts/drafts",
  ]);
  await expect(
    rename("artifacts/drafts", "renamed", async () => {
      throw new Error("database failed");
    })
  ).rejects.toThrow("database failed");
  await expect(
    rename("artifacts/drafts/summary.md", "failed.md", async () => {
      throw new Error("database failed");
    })
  ).rejects.toThrow("database failed");
  expect((await listArtifacts(ORG_ID, PROFILE_ID)).artifacts[0]?.filename).toBe(
    "drafts/summary.md"
  );
  expect(
    readFileSync(
      path.join(
        getProfileArtifactsDir(ORG_ID, PROFILE_ID),
        "drafts/summary.md"
      ),
      "utf8"
    )
  ).toBe("report");
  await expect(
    readWorkspaceFile(ORG_ID, PROFILE_ID, "artifacts/renamed/summary.md")
  ).rejects.toMatchObject({ status: 404 });
});

test("workspace rename rejects invalid names, managed paths, symlinks and collisions without overwriting", async () => {
  await writeArtifact("report.md", "source");
  await writeArtifact("existing.md", "destination");
  const rename = (filename: string, newName: string) =>
    renameWorkspaceEntry({
      newName,
      orgId: ORG_ID,
      path: filename,
      profileId: PROFILE_ID,
      updateReferences: async () => {},
    });
  for (const name of [
    "",
    ".",
    "..",
    "../escape",
    "nested/name",
    "a\\b",
    "a\0b",
    " spaced ",
    "bad.",
  ]) {
    await expect(rename("artifacts/report.md", name)).rejects.toMatchObject({
      status: 400,
    });
  }
  for (const filename of [
    "",
    "../outside",
    "/tmp/file",
    "artifacts/../SOUL.md",
    "SOUL.md",
    "USER.md",
    "artifacts",
    "data",
    "examples",
    "attachments",
    "attachments/upload.txt",
    "ATTACHMENTS/upload.txt",
    "knowledge-base",
    "knowledge-base/index.json",
    "memory-archive",
    "memory-archive/2026-09.md",
    "skills",
    "skills/test",
    "artifacts/coding-agent-runs",
    "artifacts/coding-agent-runs/run.log",
    "data/knowledge-base",
    "data/knowledge-base/index.json",
    "data/memory-archive",
    "data/memory-archive/2026-09.md",
    "artifacts/report.md.nakama-meta.json",
  ]) {
    await expect(rename(filename, "changed")).rejects.toMatchObject({
      status: 400,
    });
  }
  await symlink(
    "report.md",
    path.join(getProfileArtifactsDir(ORG_ID, PROFILE_ID), "link.md")
  );
  await expect(rename("artifacts/link.md", "changed.md")).rejects.toMatchObject(
    { status: 400 }
  );
  await symlink(
    "missing",
    path.join(getProfileArtifactsDir(ORG_ID, PROFILE_ID), "dangling.md")
  );
  await expect(
    rename("artifacts/report.md", "dangling.md")
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    rename("artifacts/report.md", "existing.md")
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    rename("artifacts/missing.md", "changed.md")
  ).rejects.toMatchObject({ status: 404 });
  expect(
    readFileSync(
      path.join(getProfileArtifactsDir(ORG_ID, PROFILE_ID), "existing.md"),
      "utf8"
    )
  ).toBe("destination");
  const concurrent = await Promise.allSettled([
    rename("artifacts/report.md", "winner.md"),
    rename("artifacts/existing.md", "winner.md"),
  ]);
  expect(
    concurrent.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  expect(
    concurrent.filter((result) => result.status === "rejected")
  ).toHaveLength(1);
  expect(
    (await listArtifacts(ORG_ID, PROFILE_ID)).artifacts
      .map((file) => file.filename)
      .sort()
  ).toEqual(["existing.md", "winner.md"]);
});

test("workspace rename reserves managed destinations but allows ordinary folders", async () => {
  const root = getProfileSoulDir(ORG_ID, PROFILE_ID);
  const rename = (filename: string, newName: string) =>
    renameWorkspaceEntry({
      newName,
      orgId: ORG_ID,
      path: filename,
      profileId: PROFILE_ID,
      updateReferences: async () => {},
    });
  for (const [filename, reservedName] of [
    ["notes", "attachments"],
    ["artifacts/reports", "coding-agent-runs"],
    ["data/reports", "knowledge-base"],
    ["data/archives", "memory-archive"],
  ] as const) {
    await mkdir(path.join(root, filename), { recursive: true });
    await writeFile(path.join(root, filename, "report.txt"), "report");
    await expect(rename(filename, reservedName)).rejects.toMatchObject({
      status: 400,
    });
    expect(readFileSync(path.join(root, filename, "report.txt"), "utf8")).toBe(
      "report"
    );
  }
  for (const filename of [
    "data/reports",
    "memory-history",
    "attachments-backup",
    "artifacts/coding-agent-runs-backup",
    "notes/skills",
    "examples/custom",
  ]) {
    await mkdir(path.join(root, filename), { recursive: true });
    await writeFile(path.join(root, filename, "report.txt"), "report");
    const newPath = path.posix.join(path.posix.dirname(filename), "renamed");
    expect(await rename(filename, "renamed")).toMatchObject({
      kind: "directory",
      path: newPath,
    });
    expect(readFileSync(path.join(root, newPath, "report.txt"), "utf8")).toBe(
      "report"
    );
    await rm(path.join(root, newPath), { recursive: true });
  }
});

let configDir: string;
let previousConfigDir: string | undefined;

test("readWorkspaceFile converts a Word file when markdown is requested", async () => {
  await mkdir(path.join(getProfileSoulDir(ORG_ID, PROFILE_ID), "docs"), {
    recursive: true,
  });
  const target = path.join(
    getProfileSoulDir(ORG_ID, PROFILE_ID),
    "docs",
    "report.docx"
  );
  await copyFile(SAMPLE_DOCX_PATH, target);

  const rendered = await readWorkspaceFile(
    ORG_ID,
    PROFILE_ID,
    "docs/report.docx",
    {
      render: "markdown",
    }
  );

  // A preview panel can do nothing with raw .docx zip bytes, so the conversion
  // has to happen here rather than in the browser.
  expect(rendered.contentType).toBe("text/markdown");
  expect("markdown" in rendered).toBe(true);

  const raw = await readWorkspaceFile(ORG_ID, PROFILE_ID, "docs/report.docx");

  // Without the flag the bytes are untouched, so every existing download link
  // keeps serving the real file.
  expect(raw.contentType).not.toBe("text/markdown");
  expect("markdown" in raw).toBe(false);
});

test("readWorkspaceFile leaves a non-Word file alone even when markdown is asked for", async () => {
  await writeArtifact("notes/plain.md", "# Plain");

  const result = await readWorkspaceFile(
    ORG_ID,
    PROFILE_ID,
    "artifacts/notes/plain.md",
    { render: "markdown" }
  );

  expect("markdown" in result).toBe(false);
  expect(result.contentType).toBe("text/markdown");
});

async function writeAppUserArtifact(
  appUserId: string,
  relativePath: string,
  content: string
): Promise<void> {
  const target = path.join(
    getAppUserSoulDir(ORG_ID, PROFILE_ID, appUserId),
    "artifacts",
    relativePath
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("an app user reads their own artifact and not another one's", async () => {
  await writeAppUserArtifact("user-1", "report.md", "first user");
  await writeAppUserArtifact("user-2", "report.md", "second user");
  await writeArtifact("report.md", "shared folder");

  const first = await readArtifactFile({
    appUserId: "user-1",
    filename: "report.md",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });
  expect(first.bytes.toString("utf8")).toBe("first user");

  // Same filename, different owner. Before this, both resolved the shared
  // folder, so the name alone decided what you got.
  const second = await readArtifactFile({
    appUserId: "user-2",
    filename: "report.md",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });
  expect(second.bytes.toString("utf8")).toBe("second user");
});

test("an app user cannot reach an artifact that only another one has", async () => {
  await writeAppUserArtifact("user-1", "private.md", "only user-1 has this");

  // Not a different body, a miss. The file is outside the caller's folder.
  await expect(
    readArtifactFile({
      appUserId: "user-2",
      filename: "private.md",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toThrow();

  const listed = await listArtifacts(ORG_ID, PROFILE_ID, {
    appUserId: "user-2",
  });
  expect(listed.artifacts.map((entry) => entry.filename)).not.toContain(
    "private.md"
  );
});

test("no app user still resolves the shared profile folder", async () => {
  await writeArtifact("shared.md", "shared folder");
  await writeAppUserArtifact("user-1", "owned.md", "owned");

  const shared = await readArtifactFile({
    filename: "shared.md",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });
  expect(shared.bytes.toString("utf8")).toBe("shared folder");

  // The dashboard and the local token send no app user, so their view must not
  // change: an owned file is not theirs to see, and was not before either.
  const listed = await listArtifacts(ORG_ID, PROFILE_ID);
  const names = listed.artifacts.map((entry) => entry.filename);
  expect(names).toContain("shared.md");
  expect(names).not.toContain("owned.md");
});

beforeEach(async () => {
  previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  configDir = await mkdtemp(path.join(tmpdir(), "nakama-artifacts-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await mkdir(getProfileArtifactsDir(ORG_ID, PROFILE_ID), { recursive: true });
});

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  await rm(configDir, { force: true, recursive: true });
});

async function writeArtifact(
  relativePath: string,
  content: string
): Promise<void> {
  const target = path.join(
    getProfileArtifactsDir(ORG_ID, PROFILE_ID),
    relativePath
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("serves a markdown artifact without a sidecar as text/markdown", async () => {
  await writeArtifact("report.md", "# Title\n");

  const artifact = await readArtifactFile({
    filename: "report.md",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });

  expect(artifact.contentType).toBe("text/markdown");
  expect(artifact.bytes.toString("utf8")).toBe("# Title\n");
});

test("prefers the sidecar mime type when present", async () => {
  await writeArtifact("page.html", "<p>hi</p>");
  await writeArtifact(
    "page.html.nakama-meta.json",
    JSON.stringify({
      mimeType: "text/html",
      savedAt: "2026-01-01T00:00:00.000Z",
      sizeBytes: 9,
    })
  );

  const artifact = await readArtifactFile({
    filename: "page.html",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });

  expect(artifact.contentType).toBe("text/html");
});

test("keeps the binary fallback for unknown extensions", async () => {
  await writeArtifact("blob.bin", "raw");

  const artifact = await readArtifactFile({
    filename: "blob.bin",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });

  expect(artifact.contentType).toBe("application/octet-stream");
});

test("serves a docx as raw bytes for download, and as markdown for preview", async () => {
  const target = path.join(
    getProfileArtifactsDir(ORG_ID, PROFILE_ID),
    "laporan.docx"
  );
  await copyFile(SAMPLE_DOCX_PATH, target);

  const download = await readArtifactFile({
    filename: "laporan.docx",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });

  expect(download.contentType).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  expect(download.bytes).toEqual(readFileSync(SAMPLE_DOCX_PATH));

  const preview = await readArtifactFile({
    filename: "laporan.docx",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
    render: "markdown",
  });

  expect(preview.contentType).toBe("text/markdown");
  expect(preview.bytes.toString("utf8")).toContain("Laporan Mingguan");
});

test("previews HTML that an agent saved under a Word extension", async () => {
  await writeArtifact(
    "palsu.docx",
    "<html><head><style>body { font-family: Calibri; }</style></head><body><h1>Laporan</h1></body></html>"
  );

  const preview = await readArtifactFile({
    filename: "palsu.docx",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
    render: "markdown",
  });

  expect(preview.bytes.toString("utf8")).toContain("# Laporan");
  expect(preview.bytes.toString("utf8")).not.toContain("font-family");
});

test("refuses to preview a genuine legacy OLE .doc with an actionable message", async () => {
  const target = path.join(
    getProfileArtifactsDir(ORG_ID, PROFILE_ID),
    "lama.doc"
  );
  await writeFile(
    target,
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  );

  expect(
    readArtifactFile({
      filename: "lama.doc",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      render: "markdown",
    })
  ).rejects.toThrow(/Convert the file to \.docx/);
});

test("lists sidecar-less artifacts with an inferred mime type", async () => {
  await writeArtifact("weekly/summary.md", "# Weekly\n");

  const listing = await listArtifacts(ORG_ID, PROFILE_ID);
  const summary = listing.artifacts.find((file) =>
    file.filename.endsWith("summary.md")
  );

  expect(summary?.mimeType).toBe("text/markdown");
  expect(listing.total).toBe(listing.artifacts.length);
});

test("folder pagination excludes unrelated artifacts from its total", async () => {
  await writeArtifact("video-test/clip.mp4", "video");
  await writeArtifact("video-test/preview.html", "preview");
  await writeArtifact("video-test-other/file.txt", "unrelated");
  await writeArtifact("root.txt", "unrelated");

  const first = await listArtifacts(ORG_ID, PROFILE_ID, {
    folder: "video-test",
    limit: 1,
  });
  expect(first.total).toBe(2);
  expect(first.artifacts).toHaveLength(1);
  expect(first.artifacts[0]?.filename.startsWith("video-test/")).toBe(true);
  const second = await listArtifacts(ORG_ID, PROFILE_ID, {
    folder: "video-test",
    limit: 1,
    offset: 1,
  });
  expect(second.total).toBe(2);
  expect(second.artifacts).toHaveLength(1);
  expect(second.artifacts[0]?.filename).not.toBe(first.artifacts[0]?.filename);
  const empty = await listArtifacts(ORG_ID, PROFILE_ID, {
    folder: "missing",
    limit: 30,
  });
  expect(empty.total).toBe(0);
  expect(empty.artifacts).toEqual([]);
});

test("paginates artifacts with limit and offset", async () => {
  for (let index = 0; index < 5; index += 1) {
    await writeArtifact(`file-${index}.txt`, `content ${index}`);
  }

  const page1 = await listArtifacts(ORG_ID, PROFILE_ID, {
    limit: 2,
    offset: 0,
  });
  expect(page1.total).toBe(5);
  expect(page1.artifacts).toHaveLength(2);
  expect(page1.limit).toBe(2);
  expect(page1.offset).toBe(0);

  const page2 = await listArtifacts(ORG_ID, PROFILE_ID, {
    limit: 2,
    offset: 2,
  });
  expect(page2.artifacts).toHaveLength(2);
  expect(page2.offset).toBe(2);

  const page3 = await listArtifacts(ORG_ID, PROFILE_ID, {
    limit: 2,
    offset: 4,
  });
  expect(page3.artifacts).toHaveLength(1);
});

test("saves an edit and refreshes the sidecar size and timestamp", async () => {
  await writeArtifact("script.md", "# Draft\n");
  await writeArtifact(
    "script.md.nakama-meta.json",
    JSON.stringify({
      mimeType: "text/markdown",
      savedAt: "2020-01-01T00:00:00.000Z",
      sizeBytes: 8,
    })
  );

  const saved = await writeArtifactFile({
    content: "# Draft\n\n## Hook\n\nRewritten by hand.\n",
    filename: "script.md",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });

  const artifact = await readArtifactFile({
    filename: "script.md",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });
  expect(artifact.bytes.toString("utf8")).toContain("Rewritten by hand.");

  const [listed] = (await listArtifacts(ORG_ID, PROFILE_ID)).artifacts;
  expect(listed.sizeBytes).toBe(saved.sizeBytes);
  expect(listed.updatedAt).toBe(saved.updatedAt);
  expect(listed.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
});

test("refuses to overwrite a non-markdown artifact", async () => {
  await writeArtifact("data.json", '{"a":1}');

  await expect(
    writeArtifactFile({
      content: "not json anymore",
      filename: "data.json",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toThrow(/Only markdown artifacts can be edited: data\.json/);

  const artifact = await readArtifactFile({
    filename: "data.json",
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });
  expect(artifact.bytes.toString("utf8")).toBe('{"a":1}');
});

test("refuses to write outside the artifacts directory", async () => {
  await writeArtifact("script.md", "# Draft\n");

  await expect(
    writeArtifactFile({
      content: "owned",
      filename: "../../escaped.md",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toThrow();
});

test("names the artifact, not the server path, when the file is gone", async () => {
  await expect(
    writeArtifactFile({
      content: "# Recovered\n",
      filename: "missing.md",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toThrow("Artifact not found: missing.md");
});

test("a missing artifact is a 404, not a server error", async () => {
  await expect(
    readArtifactFile({
      filename: "shots/review-frames.html",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toMatchObject({ status: 404 });

  // A profile that has never written an artifact has no artifacts dir yet.
  await expect(
    readArtifactFile({
      filename: "report.md",
      orgId: ORG_ID,
      profileId: "profile_without_artifacts",
    })
  ).rejects.toMatchObject({ status: 404 });

  // The Files page passes the absolute path; the message must not echo it.
  const absolute = path.join(
    getProfileArtifactsDir(ORG_ID, PROFILE_ID),
    "review-frames.html"
  );
  await expect(
    readArtifactFile({
      filename: absolute,
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toMatchObject({
    message: "Artifact not found: review-frames.html",
    status: 404,
  });

  await writeArtifact("report.md", "# Title\n");
  await expect(
    readArtifactFile({
      filename: "report.md/nested.md",
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    })
  ).rejects.toMatchObject({ status: 404 });
});

test("workspace browsing includes root files, empty folders and nested files", async () => {
  const root = getProfileSoulDir(ORG_ID, PROFILE_ID);
  await mkdir(path.join(root, "empty"));
  await writeFile(path.join(root, "SOUL.md"), "# Soul");
  await writeFile(path.join(root, ".env"), "LOCAL=value");
  await writeArtifact("nested/report.md", "# Report");
  const listing = await listWorkspaceFiles(ORG_ID, PROFILE_ID);
  expect(
    listing.entries.map(({ filename, kind }) => ({ filename, kind }))
  ).toEqual([
    { filename: "artifacts", kind: "directory" },
    { filename: "empty", kind: "directory" },
    { filename: ".env", kind: "file" },
    { filename: "SOUL.md", kind: "file" },
  ]);
  expect(
    (await listWorkspaceFiles(ORG_ID, PROFILE_ID, "empty")).entries
  ).toEqual([]);
  const nested = await listWorkspaceFiles(
    ORG_ID,
    PROFILE_ID,
    "artifacts/nested"
  );
  expect(nested.entries[0]?.path).toBe("artifacts/nested/report.md");
  const file = await readWorkspaceFile(ORG_ID, PROFILE_ID, "SOUL.md");
  expect(file.contentType).toBe("text/markdown");
  expect(await Bun.file(file.filePath).text()).toBe("# Soul");
});

test("workspace paths reject traversal and symlinks outside the profile", async () => {
  const root = getProfileSoulDir(ORG_ID, PROFILE_ID);
  const other = getProfileSoulDir("other_org", "other_profile");
  await mkdir(other, { recursive: true });
  await writeFile(path.join(other, "private.txt"), "private");
  await symlink(other, path.join(root, "escape"));
  for (const filename of [
    "../other_profile/private.txt",
    path.join(other, "private.txt"),
    "escape/private.txt",
    "bad\0path",
    "..\\private.txt",
  ]) {
    await expect(
      readWorkspaceFile(ORG_ID, PROFILE_ID, filename)
    ).rejects.toMatchObject({ status: 400 });
  }
  await expect(
    listWorkspaceFiles(ORG_ID, PROFILE_ID, "escape")
  ).rejects.toMatchObject({ status: 400 });
  expect(
    (await listWorkspaceFiles(ORG_ID, PROFILE_ID)).entries.some(
      (entry) => entry.filename === "escape"
    )
  ).toBe(false);
  await expect(
    readWorkspaceFile(ORG_ID, PROFILE_ID, "missing.txt")
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    readWorkspaceFile(ORG_ID, PROFILE_ID, "artifacts")
  ).rejects.toMatchObject({ status: 404 });
  expect((await listWorkspaceFiles(ORG_ID, "new_profile")).entries).toEqual([]);
});
