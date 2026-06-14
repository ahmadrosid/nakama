import { listKnowledgeBaseDocuments } from "./store";

export async function composeKnowledgeBaseCatalog(profileId: string): Promise<string> {
  const documents = await listKnowledgeBaseDocuments(profileId);
  const readyDocuments = documents.filter((document) => document.status === "ready");

  if (readyDocuments.length === 0) {
    return "";
  }

  const lines = [
    "# Knowledge Base",
    "Use knowledge_base_search to look up facts from uploaded documents on demand.",
  ];

  for (const document of readyDocuments) {
    lines.push(`- ${document.filename} (${document.mediaType})`);
  }

  return lines.join("\n");
}
