import { describe, expect, test } from "bun:test";
import { routeErrorStateFromResetKey } from "@/components/route-error-state";

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
