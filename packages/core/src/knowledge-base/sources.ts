import type { KnowledgeBaseSource } from "../contract";

export const DEFAULT_KNOWLEDGE_SOURCES: KnowledgeBaseSource[] = [
  {
    id: "nakama-docs",
    title: "Nakama Documentation",
    url: "https://ahmadrosid.github.io/nakama",
    description:
      "Official Nakama docs for setup, profiles, tools, orgs, integrations, API, and troubleshooting.",
    kind: "url",
    inherited: true,
    enabled: true,
  },
];

export async function listKnowledgeBaseSources(): Promise<KnowledgeBaseSource[]> {
  return DEFAULT_KNOWLEDGE_SOURCES.filter((source) => source.enabled).map((source) => ({
    ...source,
  }));
}
