import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
import type { JsonRecord, JsonValue } from "./actions";

export type Item = {
  id: string;
  title: string;
  source: string;
  state: string;
  excerpt?: string;
  message?: string;
};

export type Profile = { id: string; name: string };

type ItemList = { hasMore: boolean; items: Item[] };

type ItemActionResult = { item?: Item; items?: Item[] };

export type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  signal: AbortSignal;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: JsonValue): Promise<JsonValue> };
};

export const errorText = (error: Error | string) =>
  error instanceof Error ? error.message : error;

export function asJsonRecord(value: JsonValue): JsonRecord | null {
  return value instanceof Object && !Array.isArray(value) ? value : null;
}

export function readJsonString(value: JsonValue | undefined): string | null {
  return value === String(value) ? value : null;
}

export function readItem(value: JsonValue): Item {
  const record = asJsonRecord(value);
  const id = record && readJsonString(record.id);
  const title = record && readJsonString(record.title);
  const source = record && readJsonString(record.source);
  const state = record && readJsonString(record.state);

  if (!(id && title && source && state)) {
    throw new Error("Invalid Supermemory item response");
  }

  const excerpt = readJsonString(record.excerpt);
  const message = readJsonString(record.message);

  const item: Item = {
    id,
    message: message ?? undefined,
    source,
    state,
    title,
  };

  if (excerpt !== null) {
    item.excerpt = excerpt;
  }

  return item;
}

export function readItemList(value: JsonValue): ItemList {
  const record = asJsonRecord(value);

  if (!(record && Array.isArray(record.items))) {
    throw new Error("Invalid Supermemory item list response");
  }

  return {
    hasMore: record.hasMore === true,
    items: record.items.map(readItem),
  };
}

export function readItemAction(value: JsonValue): ItemActionResult {
  const record = asJsonRecord(value);

  if (record && Array.isArray(record.items)) {
    return { items: record.items.map(readItem) };
  }

  return { item: readItem(value) };
}
