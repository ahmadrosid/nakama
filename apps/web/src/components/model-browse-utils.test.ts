import { describe, expect, test } from "bun:test";
import { FIREWORKS_FALLBACK_ROWS } from "@/hooks/use-fireworks-discover-models";
import { capabilityBrowseRowToModelListRow } from "@/components/model-browse-utils";

describe("capabilityBrowseRowToModelListRow", () => {
  test("maps reasoning and vision flags from browse rows", () => {
    const row = FIREWORKS_FALLBACK_ROWS.find(
      (entry) => entry.id === "accounts/fireworks/models/kimi-k2p5",
    )!;

    expect(capabilityBrowseRowToModelListRow(row)).toEqual({
      id: "accounts/fireworks/models/kimi-k2p5",
      name: "Kimi K2.5",
      supportsThinking: true,
      supportsVision: true,
      inputPerMillionUsd: 0.6,
      outputPerMillionUsd: 2.5,
    });
  });
});

describe("FIREWORKS_FALLBACK_ROWS", () => {
  test("includes representative serverless ids with full paths", () => {
    expect(
      FIREWORKS_FALLBACK_ROWS.some((row) => row.id.startsWith("accounts/fireworks/models/")),
    ).toBe(true);
  });
});
