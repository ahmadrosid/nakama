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
      "# Nakama documentation (inherited)",
      "Do not use knowledge_base_search for Nakama product docs — that tool only searches uploaded files above.",
      "",
      "When the user asks about Nakama setup, profiles, tools, organizations, integrations, channels, API, or troubleshooting:",
      `1. web_fetch ${NAKAMA_DOCS_LLMS_URL} to load the docs index and topic routing`,
      "2. web_fetch the matching .md page from that index (pages use a .md suffix)",
      "3. Answer from the fetched page — do not guess product details",
      "",
      ...sources.map((source) => `- ${source.title}: ${source.url} — ${source.description}`),
    );
  }

  return sections.join("\n");
}
