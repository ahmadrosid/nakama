import { describe, expect, test } from "bun:test";
import {
  getInitialRecentsCollapsed,
  getInitialSidebarCollapsed,
  pinnedPluginsStorageKey,
  readPinnedPluginIds,
  SIDEBAR_RECENTS_COLLAPSED_KEY,
  subscribePinnedPlugins,
  togglePinnedPlugin,
} from "./sidebar";

describe("sidebar collapse preferences", () => {
  test("defaults to expanded when storage is empty", () => {
    expect(getInitialSidebarCollapsed()).toBe(false);
    expect(getInitialRecentsCollapsed()).toBe(false);
  });
});

test.each([false, true])(
  "recents collapse preference is independent of the sidebar: %s",
  (collapsed) => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) =>
          String(
            key === SIDEBAR_RECENTS_COLLAPSED_KEY ? collapsed : !collapsed
          ),
      },
    });

    try {
      expect(getInitialRecentsCollapsed()).toBe(collapsed);
      expect(getInitialSidebarCollapsed()).toBe(!collapsed);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  }
);

test("a pin is kept per person and organization, and toggles off again", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  const mine = pinnedPluginsStorageKey("user-a", "org-1");
  let notified = 0;

  const unsubscribe = subscribePinnedPlugins(() => {
    notified += 1;
  });

  try {
    togglePinnedPlugin(mine, "workflows");
    togglePinnedPlugin(mine, "notes");
    expect(readPinnedPluginIds(mine)).toEqual(["workflows", "notes"]);
    expect(
      readPinnedPluginIds(pinnedPluginsStorageKey("user-b", "org-1"))
    ).toEqual([]);
    expect(
      readPinnedPluginIds(pinnedPluginsStorageKey("user-a", "org-2"))
    ).toEqual([]);

    togglePinnedPlugin(mine, "workflows");
    expect(readPinnedPluginIds(mine)).toEqual(["notes"]);
    expect(notified).toBe(3);

    stored.set(mine, "{not json");
    expect(readPinnedPluginIds(mine)).toEqual([]);
    expect(readPinnedPluginIds(null)).toEqual([]);
  } finally {
    unsubscribe();

    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});
