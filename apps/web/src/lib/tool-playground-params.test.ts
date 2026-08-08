import { describe, expect, test } from "bun:test";
import {
  buildExampleParametersJson,
  exampleParametersFromSchema,
} from "./tool-playground-params";

describe("tool playground params", () => {
  test("builds example object from schema properties", () => {
    expect(
      exampleParametersFromSchema({
        properties: {
          active: { type: "boolean" },
          limit: { type: "integer" },
          mode: { enum: ["fast", "slow"], type: "string" },
          query: { type: "string" },
        },
        required: ["query"],
        type: "object",
      })
    ).toEqual({
      active: false,
      limit: 0,
      mode: "fast",
      query: "",
    });
  });

  test("returns empty object without properties", () => {
    expect(
      buildExampleParametersJson({ additionalProperties: true, type: "object" })
    ).toBe("{}");
  });
});
