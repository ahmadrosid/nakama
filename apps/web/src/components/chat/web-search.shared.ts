export type WebSearchSiteState = "pending" | "loading" | "done";

export type WebSourceCardMode = "search" | "fetch";

export interface WebSearchSource {
  title: string;
  url: string;
  href?: string;
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
