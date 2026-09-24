import type { Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { NakamaApiError } from "./api-error";
import {
  inferArtifactMimeType,
  isDocxFile,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
} from "./artifact-mime";
import { createChatLock } from "./channel-chat-lock";
import type {
  ArtifactFile,
  DeleteArtifactResponse,
  ListArtifactsOptions,
  ListArtifactsResponse,
  ListWorkspaceFilesResponse,
  UpdateArtifactResponse,
  WorkspaceEntry,
} from "./contract";
import { convertDocxToMarkdown } from "./docx-text";
import { pathExists } from "./fs";
import { SOUL_FILES } from "./soul/load";
import {
  getAppUserSoulDir,
  getProfileArtifactsDir,
  getProfileSoulDir,
} from "./soul/resolve";

/**
 * Where an artifact written by this org and profile is stored.
 *
 * An app user's own folder, or the shared profile folder when no app user is
 * named. Reads go through `artifactReadDirs` instead, which falls back to the
 * shared folder; this is the single destination a write picks.
 */
function artifactsDirFor(
  orgId: string,
  profileId: string,
  appUserId?: string | null
): string {
  const trimmed = appUserId?.trim();

  return trimmed
    ? path.join(getAppUserSoulDir(orgId, profileId, trimmed), "artifacts")
    : getProfileArtifactsDir(orgId, profileId);
}

import { guardFilePath, PathGuardError } from "./tools/paths";

const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
// ponytail: per-process locking; coordinate replicas before sharing writable workspaces.
const workspaceRenameLock = createChatLock();

const artifactMetaSchema = z.object({
  mimeType: z.string().trim().min(1),
  savedAt: z.string().trim().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

type ArtifactMeta = z.infer<typeof artifactMetaSchema>;

function getArtifactMetaPath(filePath: string): string {
  return `${filePath}${ARTIFACT_META_SUFFIX}`;
}

function isArtifactMetaFile(filename: string): boolean {
  return filename.endsWith(ARTIFACT_META_SUFFIX);
}

export async function listArtifacts(
  orgId: string,
  profileId: string,
  options: ListArtifactsOptions = {}
): Promise<ListArtifactsResponse> {
  const directory = artifactsDirFor(orgId, profileId, options.appUserId);

  if (!(await pathExists(directory))) {
    return { artifacts: [], directory, profileId, total: 0 };
  }

  const resolvedDirectory = await realpath(directory);
  const files = await walkArtifacts(resolvedDirectory, resolvedDirectory);
  const folder = options.folder
    ?.replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  const artifacts = folder
    ? files.filter((file) => file.filename.startsWith(`${folder}/`))
    : files;
  artifacts.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );

  const total = artifacts.length;
  const offset = options.offset ?? 0;

  if (options.limit !== undefined) {
    return {
      artifacts: artifacts.slice(offset, offset + options.limit),
      directory: resolvedDirectory,
      limit: options.limit,
      offset,
      profileId,
      total,
    };
  }

  return { artifacts, directory: resolvedDirectory, profileId, total };
}

async function walkArtifacts(
  rootDir: string,
  currentDir: string
): Promise<ArtifactFile[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: ArtifactFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkArtifacts(rootDir, absolutePath)));
      continue;
    }

    if (!entry.isFile() || isArtifactMetaFile(entry.name)) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    const metadata = await readArtifactMeta(
      absolutePath,
      fileStat.size,
      fileStat.mtime.toISOString()
    );
    files.push({
      filename: path.relative(rootDir, absolutePath),
      mimeType: metadata.mimeType,
      path: absolutePath,
      sizeBytes: metadata.sizeBytes,
      updatedAt: metadata.savedAt,
    });
  }

  return files;
}

async function readArtifactMeta(
  filePath: string,
  fallbackSizeBytes: number,
  fallbackSavedAt: string
): Promise<ArtifactMeta> {
  const metaPath = getArtifactMetaPath(filePath);

  try {
    const raw = await readFile(metaPath, "utf8");
    return artifactMetaSchema.parse(JSON.parse(raw));
  } catch {
    // Artifacts written straight to disk (no `save-artifact` sidecar) still need
    // an accurate type, otherwise the UI cannot preview them.
    return {
      mimeType: inferArtifactMimeType(path.basename(filePath)),
      savedAt: fallbackSavedAt,
      sizeBytes: fallbackSizeBytes,
    };
  }
}

// Callers may pass the absolute path listArtifacts returned, so name only the
// basename: the full path is the server filesystem layout.
function artifactNotFound(filename: string): NakamaApiError {
  return new NakamaApiError(
    `Artifact not found: ${path.basename(filename)}`,
    404
  );
}

// A stale chat link, or a profile that never wrote an artifact, is a missing
// resource. Left as a raw fs error it answers 500 and logs a stack per click.
function artifactNotFoundOr(error: unknown, filename: string): unknown {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR"
    ? artifactNotFound(filename)
    : error;
}

/**
 * Where to look for an artifact when the caller names an app user: that user's
 * own folder first, then the shared profile folder.
 *
 * The fallback is there because every document written before the write side
 * learned about app users is sitting in the shared folder, and dropping it
 * would strand files that exist today. It grants nothing new: the same caller
 * reaches the shared folder already by leaving the header off.
 */
function artifactReadDirs(
  orgId: string,
  profileId: string,
  appUserId?: string | null
): { directory: string; fallback: boolean }[] {
  const trimmed = appUserId?.trim();
  const shared = {
    directory: getProfileArtifactsDir(orgId, profileId),
    fallback: false,
  };

  if (!trimmed) {
    return [shared];
  }

  return [
    {
      directory: path.join(
        getAppUserSoulDir(orgId, profileId, trimmed),
        "artifacts"
      ),
      fallback: false,
    },
    { ...shared, fallback: true },
  ];
}

/**
 * A name the fallback is allowed to carry into the shared folder. An app user
 * naming an absolute path or a `..` segment is reaching outside their own
 * folder, and that stays a 404 whatever is on the other side.
 */
function isPlainArtifactName(filename: string): boolean {
  if (path.isAbsolute(filename) || filename.startsWith("~")) {
    return false;
  }

  return !filename
    .split(/[\\/]/)
    .some((segment) => segment === ".." || segment.trim() === "~");
}

/**
 * First directory holding the file, or null. Every way of failing answers the
 * same: a path the caller may not reach and a path that is not there are not
 * distinguished, so a traversal attempt learns nothing from the reply.
 */
async function locateArtifact(
  candidates: { directory: string; fallback: boolean }[],
  filename: string
): Promise<{ filePath: string; fileStat: Stats } | null> {
  for (const candidate of candidates) {
    if (candidate.fallback && !isPlainArtifactName(filename)) {
      continue;
    }
    const resolvedDir = await realpath(candidate.directory).catch(() => null);
    if (!resolvedDir) {
      continue;
    }
    const guarded = await guardFilePath(filename, null, undefined, {
      allowedDirs: [resolvedDir],
      cwd: resolvedDir,
    }).catch(() => null);
    if (!guarded) {
      continue;
    }
    const fileStat = await stat(guarded.resolved).catch(() => null);
    if (fileStat?.isFile()) {
      return { filePath: guarded.resolved, fileStat };
    }
  }

  return null;
}

export async function readArtifactFile(input: {
  /** Resolves the end user's own artifacts folder when the caller names one. */
  appUserId?: string | null;
  orgId: string;
  profileId: string;
  filename: string;
  /**
   * Convert the artifact to Markdown for preview instead of serving raw bytes.
   * Downloads must stay byte-exact, so this is opt-in.
   */
  render?: "markdown";
}): Promise<{ bytes: Buffer; contentType: string; filePath: string }> {
  const located = await locateArtifact(
    artifactReadDirs(input.orgId, input.profileId, input.appUserId),
    input.filename
  );

  if (!located) {
    throw artifactNotFound(input.filename);
  }

  const { filePath, fileStat } = located;

  const metadata = await readArtifactMeta(
    filePath,
    fileStat.size,
    fileStat.mtime.toISOString()
  );
  const bytes = await readFile(filePath);
  const filename = path.basename(filePath);

  const isWordLike =
    isDocxFile(filename, metadata.mimeType) ||
    isLegacyDocFile(filename, metadata.mimeType);

  if (input.render === "markdown" && isWordLike) {
    const markdown = await convertDocxToMarkdown(bytes);
    return {
      bytes: Buffer.from(markdown, "utf8"),
      contentType: "text/markdown",
      filePath,
    };
  }

  return {
    bytes,
    contentType: metadata.mimeType,
    filePath,
  };
}

/**
 * Hand edits are markdown-only for now: the other artifact types either round-trip
 * through a converter (docx) or have no editor, so writing raw text back would
 * corrupt the file the agent saved.
 */
export async function writeArtifactFile(input: {
  orgId: string;
  profileId: string;
  filename: string;
  content: string;
}): Promise<UpdateArtifactResponse> {
  const artifactsDir = getProfileArtifactsDir(input.orgId, input.profileId);
  const resolvedArtifactsDir = await realpath(artifactsDir);
  const guarded = await guardFilePath(input.filename, null, undefined, {
    allowedDirs: [resolvedArtifactsDir],
    cwd: resolvedArtifactsDir,
  });
  const filePath = guarded.resolved;
  // The dashboard saves by absolute path, so error copy uses the relative name:
  // it is what the user sees in the UI, and it keeps server paths out of the toast.
  const displayName = path.relative(resolvedArtifactsDir, filePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    throw new NakamaApiError(`Artifact not found: ${displayName}`, 404);
  }

  const metadata = await readArtifactMeta(
    filePath,
    fileStat.size,
    fileStat.mtime.toISOString()
  );

  if (!isMarkdownArtifactMimeType(metadata.mimeType)) {
    throw new NakamaApiError(
      `Only markdown artifacts can be edited: ${displayName}`,
      400
    );
  }

  await writeFile(filePath, input.content, "utf8");
  const updated = await stat(filePath);
  const savedAt = updated.mtime.toISOString();

  const metaPath = getArtifactMetaPath(filePath);
  if (await pathExists(metaPath)) {
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          mimeType: metadata.mimeType,
          savedAt,
          sizeBytes: updated.size,
        } satisfies ArtifactMeta,
        null,
        2
      ),
      "utf8"
    );
  }

  return {
    filename: path.relative(resolvedArtifactsDir, filePath),
    profileId: input.profileId,
    sizeBytes: updated.size,
    updatedAt: savedAt,
  };
}

export async function deleteArtifactFile(input: {
  orgId: string;
  profileId: string;
  filename: string;
}): Promise<DeleteArtifactResponse> {
  const artifactsDir = getProfileArtifactsDir(input.orgId, input.profileId);
  const resolvedArtifactsDir = await realpath(artifactsDir);
  const guarded = await guardFilePath(input.filename, null, undefined, {
    allowedDirs: [resolvedArtifactsDir],
    cwd: resolvedArtifactsDir,
  });
  const filePath = guarded.resolved;
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error(`Artifact not found: ${input.filename}`);
  }

  await unlink(filePath);

  const metaPath = getArtifactMetaPath(filePath);
  if (await pathExists(metaPath)) {
    await unlink(metaPath);
  }

  return {
    deleted: true,
    filename: path.relative(resolvedArtifactsDir, filePath),
    profileId: input.profileId,
  };
}

async function resolveWorkspacePath(
  orgId: string,
  profileId: string,
  filename: string
) {
  const root = getProfileSoulDir(orgId, profileId);
  if (
    path.isAbsolute(filename) ||
    filename.includes("\\") ||
    filename.split("/").includes("..")
  ) {
    throw new NakamaApiError("Invalid workspace path", 400);
  }
  try {
    return (
      await guardFilePath(filename || ".", null, undefined, {
        allowedDirs: [root],
        cwd: root,
      })
    ).resolved;
  } catch (error) {
    if (error instanceof PathGuardError) {
      throw new NakamaApiError("Invalid workspace path", 400);
    }
    throw error;
  }
}

export async function listWorkspaceFiles(
  orgId: string,
  profileId: string,
  folder = ""
): Promise<ListWorkspaceFilesResponse> {
  const directory = await resolveWorkspacePath(orgId, profileId, folder);
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !folder) {
      return { entries: [] };
    }
    throw artifactNotFoundOr(error, folder);
  }
  const entries: WorkspaceEntry[] = [];
  for (const child of children) {
    // Do not follow symlinks into another profile or outside the workspace.
    if (!(child.isFile() || child.isDirectory())) {
      continue;
    }
    const filename = path.posix.join(folder, child.name);
    const filePath = await resolveWorkspacePath(orgId, profileId, filename);
    const info = await stat(filePath);
    entries.push({
      filename,
      kind: child.isDirectory() ? "directory" : "file",
      mimeType: inferArtifactMimeType(child.name),
      path: filename,
      sizeBytes: info.size,
      updatedAt: info.mtime.toISOString(),
    });
  }
  entries.sort(
    (a, b) =>
      Number(b.kind === "directory") - Number(a.kind === "directory") ||
      a.filename.localeCompare(b.filename)
  );
  return { entries };
}

export async function getWorkspaceEntry(
  orgId: string,
  profileId: string,
  filename: string
) {
  const filePath = await resolveWorkspacePath(orgId, profileId, filename);
  const info = await stat(filePath).catch((error: unknown) => {
    throw artifactNotFoundOr(error, filename);
  });
  if (!(info.isFile() || info.isDirectory())) {
    throw new NakamaApiError("File not found", 404);
  }
  const entry: WorkspaceEntry = {
    filename,
    kind: info.isDirectory() ? "directory" : "file",
    mimeType: inferArtifactMimeType(filename),
    path: filename,
    sizeBytes: info.size,
    updatedAt: info.mtime.toISOString(),
  };
  return { contentType: entry.mimeType, entry, filePath };
}

export async function readWorkspaceFile(
  orgId: string,
  profileId: string,
  filename: string,
  options: { render?: "markdown" } = {}
) {
  const file = await getWorkspaceEntry(orgId, profileId, filename);
  if (file.entry.kind !== "file") {
    throw new NakamaApiError("File not found", 404);
  }

  // Same Word branch the artifacts reader has. A preview panel cannot do
  // anything with raw .docx zip bytes, so the conversion has to happen here
  // rather than in the browser.
  const isWordLike =
    isDocxFile(filename, file.contentType) ||
    isLegacyDocFile(filename, file.contentType);

  if (options.render === "markdown" && isWordLike) {
    return {
      ...file,
      contentType: "text/markdown",
      markdown: await convertDocxToMarkdown(await readFile(file.filePath)),
    };
  }

  return file;
}

function assertRenamableWorkspacePath(filename: string) {
  const parts = filename.split("/");
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    filename.includes("\\") ||
    Array.from(filename).some((char) => char.charCodeAt(0) < 32)
  ) {
    throw new NakamaApiError("Invalid workspace path", 400);
  }
  const top = parts[0]!.toLowerCase();
  const normalized = filename.toLowerCase();
  const managed = [
    "attachments",
    "knowledge-base",
    "memory-archive",
    "skills",
    "artifacts/coding-agent-runs",
    "data/knowledge-base",
    "data/memory-archive",
  ];
  const fixedNames = [
    ...Object.values(SOUL_FILES),
    "USER.md",
    "artifacts",
    "data",
    "examples",
  ];
  if (
    top.startsWith(".") ||
    managed.some(
      (directory) =>
        normalized === directory || normalized.startsWith(`${directory}/`)
    ) ||
    (parts.length === 1 &&
      fixedNames.some((name) => name.toLowerCase() === top)) ||
    normalized.endsWith(ARTIFACT_META_SUFFIX)
  ) {
    throw new NakamaApiError(
      "This path is managed by Nakama and cannot be renamed.",
      400
    );
  }
}

async function workspacePathExists(filename: string): Promise<boolean> {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Reserve the destination rather than overwriting an existing file or folder.
async function moveWorkspacePath(source: string, target: string) {
  const info = await lstat(source);
  if (info.isDirectory()) {
    // Windows already rejects replacing a directory, including an empty reservation.
    if (process.platform === "win32") {
      await rename(source, target);
      return;
    }
    await mkdir(target);
    try {
      await rename(source, target);
    } catch (error) {
      await rmdir(target);
      throw error;
    }
  } else if (info.isFile()) {
    await link(source, target);
    try {
      await unlink(source);
    } catch (error) {
      await unlink(target);
      throw error;
    }
  } else {
    throw new NakamaApiError(
      "Only regular files and folders can be renamed.",
      400
    );
  }
}

export async function renameWorkspaceEntry(input: {
  orgId: string;
  profileId: string;
  path: string;
  newName: string;
  updateReferences: (newPath: string) => Promise<void>;
}): Promise<WorkspaceEntry> {
  const { orgId, profileId, newName } = input;
  if (
    !newName ||
    newName !== newName.trim() ||
    newName.endsWith(".") ||
    /[<>:"/\\|?*]/.test(newName) ||
    Buffer.byteLength(newName) > 255
  ) {
    throw new NakamaApiError("Enter a valid file or folder name.", 400);
  }
  assertRenamableWorkspacePath(input.path);
  const newPath = path.posix.join(path.posix.dirname(input.path), newName);
  assertRenamableWorkspacePath(newPath);
  let result!: WorkspaceEntry;
  await workspaceRenameLock.withLock(
    getProfileSoulDir(orgId, profileId),
    async () => {
      const source = await getWorkspaceEntry(orgId, profileId, input.path);
      const root = await realpath(getProfileSoulDir(orgId, profileId));
      if (source.filePath !== path.join(root, input.path)) {
        throw new NakamaApiError("Symbolic links cannot be renamed.", 400);
      }
      result = {
        ...source.entry,
        filename: newPath,
        mimeType: inferArtifactMimeType(newName),
        path: newPath,
      };
      if (input.path === newPath) {
        return;
      }
      const target = path.join(path.dirname(source.filePath), newName);
      const sourceMeta = getArtifactMetaPath(source.filePath);
      const targetMeta = getArtifactMetaPath(target);
      const hasMeta =
        source.entry.kind === "file" && (await workspacePathExists(sourceMeta));
      if (
        (await workspacePathExists(target)) ||
        (await workspacePathExists(targetMeta))
      ) {
        throw new NakamaApiError(
          "A file or folder with that name already exists.",
          409
        );
      }
      const moved: [string, string][] = [];
      try {
        await moveWorkspacePath(source.filePath, target);
        moved.push([source.filePath, target]);
        if (hasMeta) {
          await moveWorkspacePath(sourceMeta, targetMeta);
          moved.push([sourceMeta, targetMeta]);
        }
        await input.updateReferences(newPath);
      } catch (error) {
        // Keep the old paths usable if metadata or the database update fails.
        for (const [before, after] of moved.reverse()) {
          await moveWorkspacePath(after, before);
        }
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new NakamaApiError(
            "A file or folder with that name already exists.",
            409
          );
        }
        throw error;
      }
    }
  );
  return result;
}
