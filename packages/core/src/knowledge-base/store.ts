import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentAttachment, KnowledgeBaseDocument } from "../contract";
import { createId } from "../ids";
import {
  ensureDir,
  pathExists,
  readTextOrNull,
  removeFile,
  writePrivateBytesFile,
  writePrivateTextFile,
} from "../fs";
import { MAX_DOCUMENT_BYTES } from "../message-content";
import {
  buildExtractedTextHeader,
  extractText,
  isSupportedKnowledgeBaseMediaType,
  normalizeKnowledgeBaseMediaType,
} from "./extract";
import { getProfileSoulDir } from "../soul/resolve";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
} from "./paths";

interface KnowledgeBaseManifest {
  documents: KnowledgeBaseDocument[];
}

async function migrateLegacyKnowledgeBaseDir(orgId: string, profileId: string): Promise<void> {
  const profileDir = getProfileSoulDir(orgId, profileId);
  const legacyDir = join(profileDir, "data", "knowledge-base");
  const currentDir = getKnowledgeBaseDir(orgId, profileId);

  if (!(await pathExists(legacyDir)) || (await pathExists(currentDir))) {
    return;
  }

  await rename(legacyDir, currentDir);
}

async function moveIfPresent(from: string, to: string): Promise<void> {
  if (!(await pathExists(from)) || (await pathExists(to))) {
    return;
  }

  await rename(from, to);
}

async function flattenKnowledgeBaseLayout(
  orgId: string,
  profileId: string,
): Promise<void> {
  const knowledgeBaseDir = getKnowledgeBaseDir(orgId, profileId);
  const uploadsDir = join(knowledgeBaseDir, "uploads");
  const extractedDir = join(knowledgeBaseDir, "extracted");

  if (await pathExists(extractedDir)) {
    const entries = await readdir(extractedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const legacyPath = join(extractedDir, entry.name);
      const documentId = entry.name.replace(/\.txt$/i, "");
      await moveIfPresent(
        legacyPath,
        getKnowledgeBaseExtractedPath(orgId, profileId, documentId),
      );
    }
    await rm(extractedDir, { recursive: true, force: true });
  }

  if (await pathExists(uploadsDir)) {
    const documentDirs = await readdir(uploadsDir, { withFileTypes: true });
    for (const documentDir of documentDirs) {
      if (!documentDir.isDirectory()) {
        continue;
      }

      const legacyDocumentDir = join(uploadsDir, documentDir.name);
      const files = await readdir(legacyDocumentDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) {
          continue;
        }

        await moveIfPresent(
          join(legacyDocumentDir, file.name),
          getKnowledgeBaseStoredDocumentPath(orgId, profileId, documentDir.name, file.name),
        );
      }
    }
    await rm(uploadsDir, { recursive: true, force: true });
  }
}

function decodeDocumentBytes(data: string): Buffer {
  const raw = data.trim();
  const base64 = raw.includes(",") ? (raw.split(",")[1] ?? "") : raw;
  return Buffer.from(base64, "base64");
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "document";

  return base.replace(/[^\w.\-() ]+/g, "_") || "document";
}

async function readManifest(orgId: string, profileId: string): Promise<KnowledgeBaseManifest> {
  await migrateLegacyKnowledgeBaseDir(orgId, profileId);
  await flattenKnowledgeBaseLayout(orgId, profileId);
  const manifestPath = getKnowledgeBaseManifestPath(orgId, profileId);
  const raw = await readTextOrNull(manifestPath);

  if (!raw) {
    return { documents: [] };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as KnowledgeBaseManifest).documents)
    ) {
      return parsed as KnowledgeBaseManifest;
    }
  } catch {
    // fall through to empty manifest
  }

  return { documents: [] };
}

async function writeManifest(
  orgId: string,
  profileId: string,
  manifest: KnowledgeBaseManifest,
): Promise<void> {
  await migrateLegacyKnowledgeBaseDir(orgId, profileId);
  await flattenKnowledgeBaseLayout(orgId, profileId);
  const manifestPath = getKnowledgeBaseManifestPath(orgId, profileId);
  const tempPath = `${manifestPath}.tmp`;
  const content = `${JSON.stringify(manifest, null, 2)}\n`;

  await writePrivateTextFile(tempPath, content);
  await rename(tempPath, manifestPath);
}

export async function ensureKnowledgeBaseDirs(orgId: string, profileId: string): Promise<void> {
  await migrateLegacyKnowledgeBaseDir(orgId, profileId);
  await flattenKnowledgeBaseLayout(orgId, profileId);
  await ensureDir(getKnowledgeBaseDir(orgId, profileId));
}

export async function listKnowledgeBaseDocuments(
  orgId: string,
  profileId: string,
): Promise<KnowledgeBaseDocument[]> {
  const manifest = await readManifest(orgId, profileId);
  return [...manifest.documents].sort((left, right) =>
    right.uploadedAt.localeCompare(left.uploadedAt),
  );
}

export async function uploadKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  attachment: DocumentAttachment,
): Promise<KnowledgeBaseDocument> {
  const filename = attachment.filename.trim();

  if (!filename) {
    throw new Error("Document filename must not be empty.");
  }

  const mediaType = normalizeKnowledgeBaseMediaType(attachment.mediaType, filename);

  if (!isSupportedKnowledgeBaseMediaType(mediaType, filename)) {
    throw new Error(
      `Unsupported knowledge base document type: ${attachment.mediaType}. Allowed: txt, md, csv, pdf.`,
    );
  }

  const bytes = decodeDocumentBytes(attachment.data);

  if (bytes.length === 0) {
    throw new Error("Document data must not be empty.");
  }

  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document must be at most ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`);
  }

  await ensureKnowledgeBaseDirs(orgId, profileId);

  const documentId = createId("kb");
  const uploadedAt = new Date().toISOString();
  const safeFilename = sanitizeFilename(filename);
  const originalPath = getKnowledgeBaseStoredDocumentPath(orgId, profileId, documentId, safeFilename);

  await writePrivateBytesFile(originalPath, bytes);

  let status: KnowledgeBaseDocument["status"] = "ready";
  let error: string | undefined;

  try {
    const body = await extractText(mediaType, filename, bytes);

    if (!body) {
      throw new Error("No text could be extracted from the document.");
    }

    const header = buildExtractedTextHeader({ filename, mediaType, uploadedAt });
    await writePrivateTextFile(
      getKnowledgeBaseExtractedPath(orgId, profileId, documentId),
      `${header}${body}\n`,
    );
  } catch (extractError) {
    status = "failed";
    error = extractError instanceof Error ? extractError.message : String(extractError);
  }

  const document: KnowledgeBaseDocument = {
    id: documentId,
    filename,
    mediaType,
    sizeBytes: bytes.length,
    uploadedAt,
    status,
    ...(error ? { error } : {}),
  };

  const manifest = await readManifest(orgId, profileId);
  manifest.documents.push(document);
  await writeManifest(orgId, profileId, manifest);

  return document;
}

export async function deleteKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string,
): Promise<boolean> {
  const manifest = await readManifest(orgId, profileId);
  const index = manifest.documents.findIndex((document) => document.id === documentId);

  if (index < 0) {
    return false;
  }

  const document = manifest.documents[index]!;
  manifest.documents.splice(index, 1);
  await writeManifest(orgId, profileId, manifest);

  const storedPath = getKnowledgeBaseStoredDocumentPath(
    orgId,
    profileId,
    documentId,
    document.filename,
  );
  const extractedPath = getKnowledgeBaseExtractedPath(orgId, profileId, documentId);

  if (await pathExists(storedPath)) {
    await removeFile(storedPath);
  }

  if (await pathExists(extractedPath)) {
    await removeFile(extractedPath);
  }

  return true;
}
