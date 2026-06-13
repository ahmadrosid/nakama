import { join } from "node:path";
import { getProfileSoulDir } from "../soul/resolve";

export const KNOWLEDGE_BASE_RELATIVE_DIR = join("data", "knowledge-base");
export const KNOWLEDGE_BASE_UPLOADS_DIR = "uploads";
export const KNOWLEDGE_BASE_EXTRACTED_DIR = "extracted";
export const KNOWLEDGE_BASE_MANIFEST_FILE = "manifest.json";

export function getKnowledgeBaseDir(profileId: string): string {
  return join(getProfileSoulDir(profileId), KNOWLEDGE_BASE_RELATIVE_DIR);
}

export function getKnowledgeBaseUploadsDir(profileId: string): string {
  return join(getKnowledgeBaseDir(profileId), KNOWLEDGE_BASE_UPLOADS_DIR);
}

export function getKnowledgeBaseExtractedDir(profileId: string): string {
  return join(getKnowledgeBaseDir(profileId), KNOWLEDGE_BASE_EXTRACTED_DIR);
}

export function getKnowledgeBaseManifestPath(profileId: string): string {
  return join(getKnowledgeBaseDir(profileId), KNOWLEDGE_BASE_MANIFEST_FILE);
}

export function getKnowledgeBaseUploadDir(profileId: string, documentId: string): string {
  return join(getKnowledgeBaseUploadsDir(profileId), documentId);
}

export function getKnowledgeBaseExtractedPath(profileId: string, documentId: string): string {
  return join(getKnowledgeBaseExtractedDir(profileId), `${documentId}.txt`);
}
