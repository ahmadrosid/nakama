import { readFile, readdir, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ArtifactFile,
  DeleteArtifactResponse,
  ListArtifactsResponse,
  SaveArtifactMode,
  SaveArtifactOutput,
} from "./contract";
import { ensureDir, pathExists, writePrivateBytesFile, writePrivateTextFile } from "./fs";
import { getProfileArtifactsDir } from "./soul/resolve";
import { guardFilePath } from "./tools/paths";

const ARTIFACT_META_SUFFIX = ".tinyclaw-meta.json";

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

function normalizeBase64(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function decodeBase64(content: string): Buffer {
  const normalized = normalizeBase64(content);

  if (!normalized || normalized.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    throw new Error("content must be valid base64.");
  }

  const bytes = Buffer.from(normalized, "base64");

  if (bytes.length === 0 && normalized !== "") {
    throw new Error("content must be valid base64.");
  }

  return bytes;
}

export async function saveArtifactFile(input: {
  orgId: string;
  profileId: string;
  filename: string;
  content: string;
  mimeType: string;
  mode: SaveArtifactMode;
}): Promise<SaveArtifactOutput> {
  const artifactsDir = getProfileArtifactsDir(input.orgId, input.profileId);
  await ensureDir(artifactsDir);
  const resolvedArtifactsDir = await realpath(artifactsDir);

  const guarded = await guardFilePath(input.filename, null, undefined, {
    allowedDirs: [resolvedArtifactsDir],
    cwd: resolvedArtifactsDir,
  });
  const filePath = guarded.resolved;
  const savedAt = new Date().toISOString();
  const bytes =
    input.mode === "base64" ? decodeBase64(input.content) : Buffer.from(input.content, "utf8");

  await writePrivateBytesFile(filePath, bytes);

  const metadata: ArtifactMeta = {
    mimeType: input.mimeType,
    savedAt,
    sizeBytes: bytes.byteLength,
  };

  await writePrivateTextFile(getArtifactMetaPath(filePath), JSON.stringify(metadata, null, 2));

  return {
    filename: path.relative(resolvedArtifactsDir, filePath),
    path: filePath,
    mimeType: input.mimeType,
    mode: input.mode,
    bytesWritten: bytes.byteLength,
  };
}

export async function listArtifacts(
  orgId: string,
  profileId: string,
): Promise<ListArtifactsResponse> {
  const directory = getProfileArtifactsDir(orgId, profileId);

  if (!(await pathExists(directory))) {
    return { profileId, directory, artifacts: [] };
  }

  const resolvedDirectory = await realpath(directory);
  const artifacts = await walkArtifacts(resolvedDirectory, resolvedDirectory);
  artifacts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return { profileId, directory: resolvedDirectory, artifacts };
}

async function walkArtifacts(rootDir: string, currentDir: string): Promise<ArtifactFile[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: ArtifactFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkArtifacts(rootDir, absolutePath));
      continue;
    }

    if (!entry.isFile() || isArtifactMetaFile(entry.name)) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    const metadata = await readArtifactMeta(absolutePath, fileStat.size, fileStat.mtime.toISOString());
    files.push({
      filename: path.relative(rootDir, absolutePath),
      path: absolutePath,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      updatedAt: metadata.savedAt,
    });
  }

  return files;
}

async function readArtifactMeta(
  filePath: string,
  fallbackSizeBytes: number,
  fallbackSavedAt: string,
): Promise<ArtifactMeta> {
  const metaPath = getArtifactMetaPath(filePath);

  try {
    const raw = await readFile(metaPath, "utf8");
    return artifactMetaSchema.parse(JSON.parse(raw));
  } catch {
    return {
      mimeType: "application/octet-stream",
      savedAt: fallbackSavedAt,
      sizeBytes: fallbackSizeBytes,
    };
  }
}

export async function readArtifactFile(input: {
  orgId: string;
  profileId: string;
  filename: string;
}): Promise<{ bytes: Buffer; contentType: string; filePath: string }> {
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

  const metadata = await readArtifactMeta(filePath, fileStat.size, fileStat.mtime.toISOString());
  const bytes = await readFile(filePath);

  return {
    bytes,
    contentType: metadata.mimeType,
    filePath,
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
    profileId: input.profileId,
    filename: path.relative(resolvedArtifactsDir, filePath),
  };
}
