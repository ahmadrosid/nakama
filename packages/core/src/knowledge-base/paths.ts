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

export function getKnowledgeBaseDir(
  orgId: string,
  profileId: string | undefined
): string {
  return profileId
    ? join(getProfileSoulDir(orgId, profileId), KNOWLEDGE_BASE_RELATIVE_DIR)
    : getOrgKnowledgeBaseDir(orgId);
}

export function getKnowledgeBaseManifestPath(
  orgId: string,
  profileId: string | undefined
): string {
  return join(
    getKnowledgeBaseDir(orgId, profileId),
    KNOWLEDGE_BASE_MANIFEST_FILE
  );
}

export function getKnowledgeBaseStoredDocumentPath(
  orgId: string,
  profileId: string | undefined,
  documentId: string,
  filename: string
): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "document";
  const sanitized = base.replace(/[^\w.\-() ]+/g, "_") || "document";
  return join(
    getKnowledgeBaseDir(orgId, profileId),
    `${assertConfigPathSegment(documentId, "documentId")}--${sanitized}`
  );
}

export function getKnowledgeBaseExtractedPath(
  orgId: string,
  profileId: string | undefined,
  documentId: string
): string {
  return join(
    getKnowledgeBaseDir(orgId, profileId),
    `${assertConfigPathSegment(documentId, "documentId")}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`
  );
}
