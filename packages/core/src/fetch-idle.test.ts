import { describe, expect, test } from "bun:test";
import {
  BUN_FETCH_DISABLE_IDLE_TIMEOUT_S,
  withDisabledFetchIdle,
} from "./fetch-idle";

describe("withDisabledFetchIdle", () => {
  test("sets Bun idleTimeout to 0 and keeps the original init", () => {
    const init = withDisabledFetchIdle({ method: "POST" });

    expect(init.method).toBe("POST");
    expect(init.idleTimeout).toBe(BUN_FETCH_DISABLE_IDLE_TIMEOUT_S);
    expect(init.idleTimeout).toBe(0);
  });
});
