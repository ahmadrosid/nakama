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
    ...profileDocuments.map((document) => ({ ...document, scope: "profile" })),
    ...organizationDocuments
      .filter((document) => sharedDocumentIds.includes(document.id))
      .map((document) => ({ ...document, scope: "organization" })),
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
      "Use knowledge_base_search to look up facts from uploaded documents on demand.",
      ...readyDocuments.map(
        (document) =>
          `- [${document.scope}] ${document.filename} (${document.mediaType}) [id: ${document.id}]`
      )
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
