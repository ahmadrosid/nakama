import type { KnowledgeBaseSource } from "../contract";

export const NAKAMA_DOCS_SITE_URL = "https://docs.getnakama.com";
export const NAKAMA_DOCS_LLMS_URL = `${NAKAMA_DOCS_SITE_URL}/llms.txt`;

export const DEFAULT_KNOWLEDGE_SOURCES: KnowledgeBaseSource[] = [
  {
    id: "nakama-docs",
    title: "Nakama Documentation",
    url: NAKAMA_DOCS_LLMS_URL,
    description:
      "Official Nakama docs index (llms.txt). Fetch this first with web_fetch, then fetch specific .md pages listed in the index.",
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
