import { describe, expect, test } from "bun:test";
import { seedShortlistManageModelRows } from "./provider-settings-seed";

describe("seedShortlistManageModelRows", () => {
  test("returns an empty list when no models are selected yet", () => {
    expect(seedShortlistManageModelRows(undefined, null, null)).toEqual([]);
    expect(seedShortlistManageModelRows([], "", "")).toEqual([]);
  });

  test("keeps saved custom models", () => {
    const rows = seedShortlistManageModelRows(
      [{ id: "stealth/ox-alpha", name: "Ox Alpha" }],
      null,
      null
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("stealth/ox-alpha");
    expect(rows[0]?.name).toBe("Ox Alpha");
  });
});
