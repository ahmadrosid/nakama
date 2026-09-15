import { describe, expect, test } from "bun:test";
import {
  getInitialRecentsCollapsed,
  getInitialSidebarCollapsed,
  SIDEBAR_RECENTS_COLLAPSED_KEY,
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
