import { DEFAULT_KNOWLEDGE_SOURCES, NAKAMA_DOCS_LLMS_URL } from "./sources";
import {
  getProfileSharedDocumentIds,
  listKnowledgeBaseDocuments,
  listOrganizationKnowledgeBaseDocuments,
} from "./store";

export async function composeKnowledgeBaseCatalog(
  orgId: string,
  profileId: string
): Promise<string> {
  const [profileDocuments, sharedDocumentIds, organizationDocuments] =
    await Promise.all([
      listKnowledgeBaseDocuments(orgId, profileId),
      getProfileSharedDocumentIds(orgId, profileId),
      listOrganizationKnowledgeBaseDocuments(orgId),
    ]);

  const documents = [
    ...profileDocuments,
    ...organizationDocuments.filter((document) =>
      sharedDocumentIds.includes(document.id)
    ),
  ];

  const sources = DEFAULT_KNOWLEDGE_SOURCES;

  const readyDocuments = documents.filter(
    (document) => document.status === "ready"
  );

  if (readyDocuments.length === 0 && sources.length === 0) {
    return "";
  }

  const sections: string[] = [];

  if (readyDocuments.length > 0) {
    sections.push(
      "# Uploaded documents",
      `${readyDocuments.length} ready documents. Use knowledge_base_search to find facts in their contents.`
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
