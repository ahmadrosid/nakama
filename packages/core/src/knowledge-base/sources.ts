import type { KnowledgeBaseSource } from "../contract";

export const NAKAMA_DOCS_SITE_URL = "https://ahmadrosid.github.io/nakama";
export const NAKAMA_DOCS_LLMS_URL = `${NAKAMA_DOCS_SITE_URL}/llms.txt`;

export const DEFAULT_KNOWLEDGE_SOURCES: KnowledgeBaseSource[] = [
  {
    description:
      "Official Nakama docs index (llms.txt). Fetch this first with web_fetch, then fetch specific .md pages listed in the index.",
    enabled: true,
    id: "nakama-docs",
    inherited: true,
    kind: "url",
    title: "Nakama Documentation",
    url: NAKAMA_DOCS_LLMS_URL,
  },
];

export async function listKnowledgeBaseSources(): Promise<
  KnowledgeBaseSource[]
> {
  return DEFAULT_KNOWLEDGE_SOURCES.filter((source) => source.enabled).map(
    (source) => ({
      ...source,
    })
  );
}
