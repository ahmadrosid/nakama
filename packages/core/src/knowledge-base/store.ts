import { rename } from "node:fs/promises";
import { rm } from "node:fs/promises";
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
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedDir,
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseUploadDir,
  getKnowledgeBaseUploadsDir,
} from "./paths";

interface KnowledgeBaseManifest {
  documents: KnowledgeBaseDocument[];
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

async function readManifest(profileId: string): Promise<KnowledgeBaseManifest> {
  const manifestPath = getKnowledgeBaseManifestPath(profileId);
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

async function writeManifest(profileId: string, manifest: KnowledgeBaseManifest): Promise<void> {
  const manifestPath = getKnowledgeBaseManifestPath(profileId);
  const tempPath = `${manifestPath}.tmp`;
  const content = `${JSON.stringify(manifest, null, 2)}\n`;

  await writePrivateTextFile(tempPath, content);
  await rename(tempPath, manifestPath);
}

export async function ensureKnowledgeBaseDirs(profileId: string): Promise<void> {
  await ensureDir(getKnowledgeBaseDir(profileId));
  await ensureDir(getKnowledgeBaseUploadsDir(profileId));
  await ensureDir(getKnowledgeBaseExtractedDir(profileId));
}

export async function listKnowledgeBaseDocuments(
  profileId: string,
): Promise<KnowledgeBaseDocument[]> {
  const manifest = await readManifest(profileId);
  return [...manifest.documents].sort((left, right) =>
    right.uploadedAt.localeCompare(left.uploadedAt),
  );
}

export async function uploadKnowledgeBaseDocument(
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

  await ensureKnowledgeBaseDirs(profileId);

  const documentId = createId("kb");
  const uploadedAt = new Date().toISOString();
  const uploadDir = getKnowledgeBaseUploadDir(profileId, documentId);
  const safeFilename = sanitizeFilename(filename);
  const originalPath = join(uploadDir, safeFilename);

  await ensureDir(uploadDir);
  await writePrivateBytesFile(originalPath, bytes);

  let status: KnowledgeBaseDocument["status"] = "ready";
  let error: string | undefined;

  try {
    const body = await extractText(mediaType, filename, bytes);

    if (!body) {
      throw new Error("No text could be extracted from the document.");
    }

    const header = buildExtractedTextHeader({ filename, mediaType, uploadedAt });
    await writePrivateTextFile(getKnowledgeBaseExtractedPath(profileId, documentId), `${header}${body}\n`);
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

  const manifest = await readManifest(profileId);
  manifest.documents.push(document);
  await writeManifest(profileId, manifest);

  return document;
}

export async function deleteKnowledgeBaseDocument(
  profileId: string,
  documentId: string,
): Promise<boolean> {
  const manifest = await readManifest(profileId);
  const index = manifest.documents.findIndex((document) => document.id === documentId);

  if (index < 0) {
    return false;
  }

  manifest.documents.splice(index, 1);
  await writeManifest(profileId, manifest);

  const uploadDir = getKnowledgeBaseUploadDir(profileId, documentId);
  const extractedPath = getKnowledgeBaseExtractedPath(profileId, documentId);

  if (await pathExists(uploadDir)) {
    await rm(uploadDir, { recursive: true, force: true });
  }

  if (await pathExists(extractedPath)) {
    await removeFile(extractedPath);
  }

  return true;
}
