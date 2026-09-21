import { describe, expect, test } from "bun:test";
import {
  routeErrorStateFromResetKey,
  shouldReloadAfterRouteError,
} from "@/components/route-error-state";

describe("routeErrorStateFromResetKey", () => {
  test("clears a failed load when the route key changes", () => {
    expect(
      routeErrorStateFromResetKey("/chat/p1/s1", {
        failed: true,
        resetKey: "/chat",
      })
    ).toEqual({ failed: false, resetKey: "/chat/p1/s1" });
  });

  test("keeps a failed load when the route key is unchanged", () => {
    expect(
      routeErrorStateFromResetKey("/chat", {
        failed: true,
        resetKey: "/chat",
      })
    ).toBeNull();
  });
});

describe("shouldReloadAfterRouteError", () => {
  test("reloads once for a stale lazy chunk error", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(
      shouldReloadAfterRouteError(
        "Failed to fetch dynamically imported module",
        storage,
        1000
      )
    ).toBe(true);
    expect(
      shouldReloadAfterRouteError(
        "Failed to fetch dynamically imported module",
        storage,
        2000
      )
    ).toBe(false);
  });

  test("does not reload for ordinary route errors", () => {
    const storage = { getItem: () => null, setItem: () => {} };
    expect(shouldReloadAfterRouteError("Request failed", storage, 1000)).toBe(
      false
    );
  });
});
