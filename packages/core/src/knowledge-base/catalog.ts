import { NAKAMA_DOCS_LLMS_URL, listKnowledgeBaseSources } from "./sources";
import { listKnowledgeBaseDocuments } from "./store";

export async function composeKnowledgeBaseCatalog(
  orgId: string,
  profileId: string,
): Promise<string> {
  const documents = await listKnowledgeBaseDocuments(orgId, profileId);
  const sources = await listKnowledgeBaseSources();
  const readyDocuments = documents.filter((document) => document.status === "ready");

  if (readyDocuments.length === 0 && sources.length === 0) {
    return "";
  }

  const sections: string[] = [];

  if (readyDocuments.length > 0) {
    sections.push(
      "# Uploaded documents",
      "Use knowledge_base_search to look up facts from uploaded documents on demand.",
      ...readyDocuments.map((document) => `- ${document.filename} (${document.mediaType})`),
    );
  }

  if (sources.length > 0) {
    sections.push(
      "# Nakama documentation",
      `For Nakama product questions, web_fetch ${NAKAMA_DOCS_LLMS_URL}, then web_fetch the matching .md page from that index. Do not use knowledge_base_search for inherited docs.`,
    );
  }

  return sections.join("\n");
}
