export type WebSearchSiteState = "pending" | "loading" | "done";

export type WebSourceCardMode = "search" | "fetch";

export interface WebSearchSource {
  href?: string;
  title: string;
  url: string;
}

export interface WebSearchToolState {
  query: string | null;
  sources: WebSearchSource[];
  status: "running" | "done";
}

export interface WebFetchToolState {
  headerText: string | null;
  sources: WebSearchSource[];
  status: "running" | "done";
}
