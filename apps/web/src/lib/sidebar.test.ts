import { describe, expect, test } from "bun:test";
import {
  getInitialPluginsNavCollapsed,
  getInitialSystemNavCollapsed,
  SIDEBAR_PLUGINS_NAV_COLLAPSED_KEY,
} from "./sidebar";

describe("sidebar system nav collapse", () => {
  test("defaults to expanded when storage is empty", () => {
    expect(getInitialSystemNavCollapsed()).toBe(false);
    expect(getInitialPluginsNavCollapsed()).toBe(false);
  });
});

test.each([false, true])(
  "plugin collapse preference is independent of System: %s",
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
            key === SIDEBAR_PLUGINS_NAV_COLLAPSED_KEY ? collapsed : !collapsed
          ),
      },
    });
    try {
      expect(getInitialPluginsNavCollapsed()).toBe(collapsed);
      expect(getInitialSystemNavCollapsed()).toBe(!collapsed);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  }
);
