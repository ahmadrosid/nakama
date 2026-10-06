import {
  getKnowledgeIndexStatus,
  isKnowledgeIndexEnabled,
  listAccessibleKnowledgeDocuments,
} from "./semantic-index";
import { DEFAULT_KNOWLEDGE_SOURCES, NAKAMA_DOCS_LLMS_URL } from "./sources";

export async function composeKnowledgeBaseCatalog(
  orgId: string,
  profileId: string
): Promise<string> {
  const [documents, enabled] = await Promise.all([
    listAccessibleKnowledgeDocuments(orgId, profileId),
    isKnowledgeIndexEnabled(orgId),
  ]);
  const sources = DEFAULT_KNOWLEDGE_SOURCES;
  const readyDocuments = documents.filter(
    (document) => document.status === "ready"
  );

  if (readyDocuments.length === 0 && sources.length === 0) {
    return "";
  }

  const sections: string[] = [];

  if (readyDocuments.length > 0) {
    const status = enabled
      ? await getKnowledgeIndexStatus(orgId, profileId)
      : null;
    sections.push("# Uploaded documents");
    sections.push(
      status && (status.status === "ready" || status.status === "partial")
        ? `${readyDocuments.length} ready; ${status.indexedCount} indexed. Use knowledge_base_index to find topics, then knowledge_base_search to verify facts.`
        : `${readyDocuments.length} ready. Use knowledge_base_search to find facts.`
    );
  }

  if (sources.length > 0) {
    sections.push(
      "# Nakama documentation",
      `For Nakama product questions, web_fetch ${NAKAMA_DOCS_LLMS_URL}, then web_fetch the matching .md page from that index. Do not use knowledge_base_search for inherited docs.`
    );
  }

  return sections.join("\n");
}
