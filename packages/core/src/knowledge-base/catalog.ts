import { listKnowledgeBaseDocuments } from "./store";
import { listKnowledgeBaseSources } from "./sources";

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

  const lines = ["# Knowledge Base"];

  if (readyDocuments.length > 0) {
    lines.push("Use knowledge_base_search to look up facts from uploaded documents on demand.");
  }

  for (const document of readyDocuments) {
    lines.push(`- ${document.filename} (${document.mediaType})`);
  }

  if (sources.length > 0) {
    lines.push(
      "Use web_fetch for listed URL sources, or web_search when you need to find a specific page under a source. For Nakama product questions, consult the Nakama documentation before answering detailed setup, profile, tool, org, integration, API, or troubleshooting questions.",
    );
  }

  for (const source of sources) {
    lines.push(`- ${source.title}: ${source.url} — ${source.description}`);
  }

  return lines.join("\n");
}
