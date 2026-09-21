import { join } from "node:path";
import { assertConfigPathSegment, getProfileSoulDir } from "../soul/resolve";
import { getOrgConfigDir } from "../user-config";

export const KNOWLEDGE_BASE_RELATIVE_DIR = "knowledge-base";
export const KNOWLEDGE_BASE_MANIFEST_FILE = "manifest.json";
export const KNOWLEDGE_BASE_EXTRACTED_SUFFIX = ".extracted.txt";

/** Root for documents shared by profiles in an organization. */
export function getOrgKnowledgeBaseDir(orgId: string): string {
  return join(getOrgConfigDir(orgId), KNOWLEDGE_BASE_RELATIVE_DIR);
}

/** Root for a single profile's own documents. */
export function getKnowledgeBaseDir(orgId: string, profileId: string): string {
  return join(getProfileSoulDir(orgId, profileId), KNOWLEDGE_BASE_RELATIVE_DIR);
}

export function getKnowledgeBaseManifestPath(dir: string): string {
  return join(dir, KNOWLEDGE_BASE_MANIFEST_FILE);
}

export function getKnowledgeBaseStoredDocumentPath(
  dir: string,
  documentId: string,
  filename: string
): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "document";
  const sanitized = base.replace(/[^\w.\-() ]+/g, "_") || "document";
  return join(
    dir,
    `${assertConfigPathSegment(documentId, "documentId")}--${sanitized}`
  );
}

export function getKnowledgeBaseExtractedPath(
  dir: string,
  documentId: string
): string {
  return join(
    dir,
    `${assertConfigPathSegment(documentId, "documentId")}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
  );
}
