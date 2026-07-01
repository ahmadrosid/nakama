import { join } from "node:path";
import { getProfileSoulDir } from "../soul/resolve";

export const KNOWLEDGE_BASE_RELATIVE_DIR = "knowledge-base";
export const KNOWLEDGE_BASE_MANIFEST_FILE = "manifest.json";
export const KNOWLEDGE_BASE_EXTRACTED_SUFFIX = ".extracted.txt";

export function getKnowledgeBaseDir(orgId: string, profileId: string): string {
  return join(getProfileSoulDir(orgId, profileId), KNOWLEDGE_BASE_RELATIVE_DIR);
}

export function getKnowledgeBaseManifestPath(orgId: string, profileId: string): string {
  return join(getKnowledgeBaseDir(orgId, profileId), KNOWLEDGE_BASE_MANIFEST_FILE);
}

export function getKnowledgeBaseStoredDocumentPath(
  orgId: string,
  profileId: string,
  documentId: string,
  filename: string,
): string {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "document";
  const sanitized = base.replace(/[^\w.\-() ]+/g, "_") || "document";
  return join(getKnowledgeBaseDir(orgId, profileId), `${documentId}--${sanitized}`);
}

export function getKnowledgeBaseExtractedPath(
  orgId: string,
  profileId: string,
  documentId: string,
): string {
  return join(getKnowledgeBaseDir(orgId, profileId), `${documentId}${KNOWLEDGE_BASE_EXTRACTED_SUFFIX}`);
}
