import { createHash } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  DocumentAttachment,
  KnowledgeBaseDocument,
  KnowledgeBaseDuplicateAction,
  KnowledgeBaseUploadOutcome,
} from "../contract";
import {
  ensureDir,
  pathExists,
  readBytes,
  readTextOrNull,
  removeFile,
  writePrivateBytesFile,
  writeTextFile,
} from "../fs";
import { createId } from "../ids";
import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from "../message-content";
import { getProfileSoulDir } from "../soul/resolve";
import { getOrgConfigDir } from "../user-config";
import {
  buildExtractedTextHeader,
  extractText,
  isSupportedKnowledgeBaseMediaType,
  normalizeKnowledgeBaseMediaType,
} from "./extract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
  getOrgKnowledgeBaseDir,
} from "./paths";

interface KnowledgeBaseManifest {
  documents: KnowledgeBaseDocument[];
  /** Additive references to organization-owned documents. */
  sharedDocumentIds?: string[];
}

export type KnowledgeBaseDuplicateMatch = "content_hash" | "name_size";

export class KnowledgeBaseDuplicateError extends Error {
  readonly existing: KnowledgeBaseDocument;
  readonly match: KnowledgeBaseDuplicateMatch;

  constructor(
    existing: KnowledgeBaseDocument,
    match: KnowledgeBaseDuplicateMatch
  ) {
    super(
      `Duplicate knowledge base document: ${existing.filename} (matched by ${match === "content_hash" ? "content hash" : "name and size"}).`
    );
    this.name = "KnowledgeBaseDuplicateError";
    this.existing = existing;
    this.match = match;
  }
}

export class KnowledgeBaseDocumentInUseError extends Error {
  constructor(
    readonly documentId: string,
    readonly profileIds: string[]
  ) {
    super(
      `Shared knowledge base document is still used by ${profileIds.length} profile(s).`
    );
    this.name = "KnowledgeBaseDocumentInUseError";
  }
}

export interface UploadKnowledgeBaseDocumentResult {
  document: KnowledgeBaseDocument;
  outcome: KnowledgeBaseUploadOutcome;
}

function findDuplicateDocument(
  documents: KnowledgeBaseDocument[],
  candidate: { contentHash: string; filename: string; sizeBytes: number }
): {
  document: KnowledgeBaseDocument;
  match: KnowledgeBaseDuplicateMatch;
} | null {
  const byHash = documents.find(
    (document) => document.contentHash === candidate.contentHash
  );
  if (byHash) {
    return { document: byHash, match: "content_hash" };
  }

  const byNameSize = documents.find(
    (document) =>
      document.filename === candidate.filename &&
      document.sizeBytes === candidate.sizeBytes
  );
  if (byNameSize) {
    return { document: byNameSize, match: "name_size" };
  }

  return null;
}

async function migrateLegacyKnowledgeBaseDir(
  orgId: string,
  profileId: string
): Promise<void> {
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

async function flattenKnowledgeBaseLayout(dir: string): Promise<void> {
  const uploadsDir = join(dir, "uploads");
  const extractedDir = join(dir, "extracted");

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
        getKnowledgeBaseExtractedPath(dir, documentId)
      );
    }
    await rm(extractedDir, { force: true, recursive: true });
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
          getKnowledgeBaseStoredDocumentPath(dir, documentDir.name, file.name)
        );
      }
    }
    await rm(uploadsDir, { force: true, recursive: true });
  }
}

/**
 * Resolve a profile's knowledge base root, migrating the pre-`knowledge-base`
 * layout first. Every profile-scoped entry point goes through here so a legacy
 * profile is never read from the wrong directory.
 */
async function profileKnowledgeBaseDir(
  orgId: string,
  profileId: string
): Promise<string> {
  await migrateLegacyKnowledgeBaseDir(orgId, profileId);
  const dir = getKnowledgeBaseDir(orgId, profileId);
  await flattenKnowledgeBaseLayout(dir);
  return dir;
}

/** Resolve the organization knowledge base root used for shared documents. */
async function orgKnowledgeBaseDir(orgId: string): Promise<string> {
  const dir = getOrgKnowledgeBaseDir(orgId);
  await flattenKnowledgeBaseLayout(dir);
  return dir;
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

async function readManifestFrom(dir: string): Promise<KnowledgeBaseManifest> {
  const manifestPath = getKnowledgeBaseManifestPath(dir);
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

async function writeManifestTo(
  dir: string,
  manifest: KnowledgeBaseManifest
): Promise<void> {
  const manifestPath = getKnowledgeBaseManifestPath(dir);
  const tempPath = `${manifestPath}.tmp`;
  const content = `${JSON.stringify(manifest, null, 2)}\n`;

  await writeTextFile(tempPath, content);
  await rename(tempPath, manifestPath);
}

function sortByUploadedAt(
  documents: KnowledgeBaseDocument[]
): KnowledgeBaseDocument[] {
  return [...documents].sort((left, right) =>
    right.uploadedAt.localeCompare(left.uploadedAt)
  );
}

export async function ensureKnowledgeBaseDirs(
  orgId: string,
  profileId: string
): Promise<void> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  await ensureDir(dir);
}

export async function listKnowledgeBaseDocuments(
  orgId: string,
  profileId: string
): Promise<KnowledgeBaseDocument[]> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  const manifest = await readManifestFrom(dir);
  return sortByUploadedAt(manifest.documents);
}

export async function listOrganizationKnowledgeBaseDocuments(
  orgId: string
): Promise<KnowledgeBaseDocument[]> {
  const manifest = await readManifestFrom(await orgKnowledgeBaseDir(orgId));
  return sortByUploadedAt(manifest.documents);
}

/**
 * Refuse to drop an organization document while any profile still references
 * it, so an attachment can never point at a missing file.
 */
async function guardSharedDocumentRemoval(
  orgId: string,
  documentId: string
): Promise<void> {
  const profileIds = await findProfilesReferencingSharedDocument(
    orgId,
    documentId
  );
  if (profileIds.length > 0) {
    throw new KnowledgeBaseDocumentInUseError(documentId, profileIds);
  }
}

async function uploadDocumentTo(
  dir: string,
  attachment: DocumentAttachment,
  onDuplicate: KnowledgeBaseDuplicateAction,
  guardRemoval?: (documentId: string) => Promise<void>
): Promise<UploadKnowledgeBaseDocumentResult> {
  const filename = attachment.filename.trim();

  if (!filename) {
    throw new Error("Document filename must not be empty.");
  }

  const mediaType = normalizeKnowledgeBaseMediaType(
    attachment.mediaType,
    filename
  );

  if (!isSupportedKnowledgeBaseMediaType(mediaType, filename)) {
    throw new Error(
      `Unsupported knowledge base document type: ${attachment.mediaType}. Allowed: txt, md, csv, pdf.`
    );
  }

  const bytes = decodeDocumentBytes(attachment.data);

  if (bytes.length === 0) {
    throw new Error("Document data must not be empty.");
  }

  if (bytes.length > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new Error(
      `Document must be at most ${MAX_KNOWLEDGE_DOCUMENT_BYTES / (1024 * 1024)} MB.`
    );
  }

  await ensureDir(dir);

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  let outcome: KnowledgeBaseUploadOutcome = "created";

  const existingManifest = await readManifestFrom(dir);
  const duplicate = findDuplicateDocument(existingManifest.documents, {
    contentHash,
    filename,
    sizeBytes: bytes.length,
  });

  if (duplicate) {
    if (onDuplicate === "skip") {
      return { document: duplicate.document, outcome: "skipped" };
    }

    if (onDuplicate === "error") {
      throw new KnowledgeBaseDuplicateError(
        duplicate.document,
        duplicate.match
      );
    }

    const removed = await deleteDocumentFrom(
      dir,
      duplicate.document.id,
      guardRemoval
    );
    if (!removed) {
      throw new Error("Failed to replace existing knowledge base document.");
    }
    outcome = "replaced";
  }

  const documentId = createId("kb");
  const uploadedAt = new Date().toISOString();
  const safeFilename = sanitizeFilename(filename);
  const originalPath = getKnowledgeBaseStoredDocumentPath(
    dir,
    documentId,
    safeFilename
  );

  await writePrivateBytesFile(originalPath, bytes);

  let status: KnowledgeBaseDocument["status"] = "ready";
  let error: string | undefined;

  try {
    const body = await extractText(mediaType, filename, bytes);

    if (!body) {
      throw new Error("No text could be extracted from the document.");
    }

    const header = buildExtractedTextHeader({
      filename,
      mediaType,
      uploadedAt,
    });
    await writeTextFile(
      getKnowledgeBaseExtractedPath(dir, documentId),
      `${header}${body}\n`
    );
  } catch (extractError) {
    status = "failed";
    error =
      extractError instanceof Error
        ? extractError.message
        : String(extractError);
  }

  const document: KnowledgeBaseDocument = {
    contentHash,
    filename,
    id: documentId,
    mediaType,
    sizeBytes: bytes.length,
    status,
    uploadedAt,
    ...(error ? { error } : {}),
  };

  const manifest = await readManifestFrom(dir);
  manifest.documents.push(document);
  await writeManifestTo(dir, manifest);

  return { document, outcome };
}

export async function uploadKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  attachment: DocumentAttachment,
  onDuplicate: KnowledgeBaseDuplicateAction = "error"
): Promise<UploadKnowledgeBaseDocumentResult> {
  return uploadDocumentTo(
    await profileKnowledgeBaseDir(orgId, profileId),
    attachment,
    onDuplicate
  );
}

export async function uploadOrganizationKnowledgeBaseDocument(
  orgId: string,
  attachment: DocumentAttachment,
  onDuplicate: KnowledgeBaseDuplicateAction = "error"
): Promise<UploadKnowledgeBaseDocumentResult> {
  return uploadDocumentTo(
    await orgKnowledgeBaseDir(orgId),
    attachment,
    onDuplicate,
    (documentId) => guardSharedDocumentRemoval(orgId, documentId)
  );
}

export async function findProfilesReferencingSharedDocument(
  orgId: string,
  documentId: string
): Promise<string[]> {
  const profilesDir = join(getOrgConfigDir(orgId), "profiles");
  if (!(await pathExists(profilesDir))) {
    return [];
  }
  const entries = await readdir(profilesDir, { withFileTypes: true });
  const profileIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = await profileKnowledgeBaseDir(orgId, entry.name);
    const manifest = await readManifestFrom(dir);
    if (manifest.sharedDocumentIds?.includes(documentId)) {
      profileIds.push(entry.name);
    }
  }
  return profileIds.sort();
}

async function deleteDocumentFrom(
  dir: string,
  documentId: string,
  guardRemoval?: (documentId: string) => Promise<void>
): Promise<boolean> {
  const manifest = await readManifestFrom(dir);
  const index = manifest.documents.findIndex(
    (document) => document.id === documentId
  );

  if (index < 0) {
    return false;
  }

  if (guardRemoval) {
    await guardRemoval(documentId);
  }

  const document = manifest.documents[index]!;
  manifest.documents.splice(index, 1);
  await writeManifestTo(dir, manifest);

  const storedPath = getKnowledgeBaseStoredDocumentPath(
    dir,
    documentId,
    document.filename
  );
  const extractedPath = getKnowledgeBaseExtractedPath(dir, documentId);

  if (await pathExists(storedPath)) {
    await removeFile(storedPath);
  }

  if (await pathExists(extractedPath)) {
    await removeFile(extractedPath);
  }

  return true;
}

export async function deleteKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string
): Promise<boolean> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  return deleteDocumentFrom(dir, documentId);
}

export async function deleteOrganizationKnowledgeBaseDocument(
  orgId: string,
  documentId: string
): Promise<boolean> {
  const dir = await orgKnowledgeBaseDir(orgId);
  return deleteDocumentFrom(dir, documentId, (candidate) =>
    guardSharedDocumentRemoval(orgId, candidate)
  );
}

export async function getProfileSharedDocumentIds(
  orgId: string,
  profileId: string
): Promise<string[]> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  const manifest = await readManifestFrom(dir);
  return [...new Set(manifest.sharedDocumentIds ?? [])];
}

export async function attachSharedKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string
): Promise<void> {
  const shared = await readManifestFrom(await orgKnowledgeBaseDir(orgId));
  if (!shared.documents.some((document) => document.id === documentId)) {
    throw new Error("Shared knowledge base document not found.");
  }
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  const manifest = await readManifestFrom(dir);
  manifest.sharedDocumentIds = [
    ...new Set([...(manifest.sharedDocumentIds ?? []), documentId]),
  ];
  await writeManifestTo(dir, manifest);
}

export async function detachSharedKnowledgeBaseDocument(
  orgId: string,
  profileId: string,
  documentId: string
): Promise<boolean> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  const manifest = await readManifestFrom(dir);
  const ids = manifest.sharedDocumentIds ?? [];
  if (!ids.includes(documentId)) {
    return false;
  }
  manifest.sharedDocumentIds = ids.filter((id) => id !== documentId);
  await writeManifestTo(dir, manifest);
  return true;
}

/**
 * Strip the metadata header that `uploadKnowledgeBaseDocument` prepends to the
 * extracted text file, so previews show the document body without the redundant
 * `# source:` / `# mediaType:` / `# uploadedAt:` preamble. Matches the exact
 * header prefixes so a markdown body that starts with `#` is never mistaken
 * for metadata.
 */
function stripExtractedTextHeader(text: string): string {
  const match = text.match(
    /^# source: [^\n]*\n# mediaType: [^\n]*\n# uploadedAt: [^\n]*\n/
  );
  if (match) {
    return text.slice(match[0].length);
  }

  return text;
}

async function readDocumentContentFrom(
  dir: string,
  documentId: string,
  options: { render?: "text" }
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const manifest = await readManifestFrom(dir);
  const document = manifest.documents.find((entry) => entry.id === documentId);

  if (!document) {
    throw new Error("Knowledge base document not found.");
  }

  const storedPath = getKnowledgeBaseStoredDocumentPath(
    dir,
    documentId,
    document.filename
  );

  const isTextLike =
    document.mediaType === "text/plain" ||
    document.mediaType === "text/csv" ||
    document.mediaType === "text/markdown";

  if (options.render === "text") {
    if (isTextLike && (await pathExists(storedPath))) {
      return {
        bytes: await readBytes(storedPath),
        contentType: document.mediaType,
        filename: document.filename,
      };
    }

    const extractedPath = getKnowledgeBaseExtractedPath(dir, documentId);

    if (await pathExists(extractedPath)) {
      const raw = (await readBytes(extractedPath)).toString("utf8");
      const body = stripExtractedTextHeader(raw);
      return {
        bytes: Buffer.from(body, "utf8"),
        contentType: "text/plain",
        filename: document.filename,
      };
    }

    throw new Error("Preview is not available for this document.");
  }

  if (!(await pathExists(storedPath))) {
    throw new Error("Knowledge base document file not found.");
  }

  return {
    bytes: await readBytes(storedPath),
    contentType: document.mediaType,
    filename: document.filename,
  };
}

export async function readKnowledgeBaseDocumentContent(
  orgId: string,
  profileId: string,
  documentId: string,
  options: { render?: "text" } = {}
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const dir = await profileKnowledgeBaseDir(orgId, profileId);
  return readDocumentContentFrom(dir, documentId, options);
}

export async function readOrganizationKnowledgeBaseDocumentContent(
  orgId: string,
  documentId: string,
  options: { render?: "text" } = {}
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const dir = await orgKnowledgeBaseDir(orgId);
  return readDocumentContentFrom(dir, documentId, options);
}
