import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
export type Item = {
  id: string;
  title: string;
  source: string;
  state: string;
  excerpt?: string;
  message?: string;
};
export type Profile = { id: string; name: string };
export type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  signal: AbortSignal;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
};

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";
