import crypto from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getArtifactSharesDir } from "./soul/resolve";
import { pathExists } from "./fs";

export function generateArtifactShareToken(): string {
  return `tc_share_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

export function buildArtifactSharePath(token: string): string {
  return `/s/${token}`;
}

export async function writeArtifactShareSnapshot(input: {
  orgId: string;
  shareId: string;
  filename: string;
  bytes: Buffer;
}): Promise<string> {
  const sharesDir = getArtifactSharesDir(input.orgId);
  const shareDir = path.join(sharesDir, input.shareId);
  await mkdir(shareDir, { recursive: true });

  const safeName = path.basename(input.filename).replace(/[^\w.\-()+ ]+/g, "_") || "artifact";
  const storagePath = path.join(shareDir, safeName);
  await writeFile(storagePath, input.bytes);
  return storagePath;
}

export async function readArtifactShareSnapshot(storagePath: string): Promise<Buffer> {
  if (!(await pathExists(storagePath))) {
    throw new Error(`Artifact share snapshot not found: ${storagePath}`);
  }

  return readFile(storagePath);
}

export async function deleteArtifactShareSnapshot(storagePath: string): Promise<void> {
  try {
    await unlink(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
