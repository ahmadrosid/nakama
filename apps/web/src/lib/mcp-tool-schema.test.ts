import { describe, expect, it } from "bun:test";
import { parseMcpToolParameters } from "./mcp-tool-schema";

describe("parseMcpToolParameters", () => {
  it("returns an empty list for invalid schemas", () => {
    expect(parseMcpToolParameters(null)).toEqual([]);
    expect(parseMcpToolParameters("invalid")).toEqual([]);
    expect(parseMcpToolParameters({})).toEqual([]);
  });

  it("extracts parameter metadata from JSON schema objects", () => {
    expect(
      parseMcpToolParameters({
        properties: {
          encoding: {
            description: "Optional text encoding",
            type: ["string", "null"],
          },
          path: {
            description: "File path to read",
            type: "string",
          },
        },
        required: ["path"],
        type: "object",
      })
    ).toEqual([
      {
        description: "File path to read",
        name: "path",
        required: true,
        type: "string",
      },
      {
        description: "Optional text encoding",
        name: "encoding",
        required: false,
        type: "string | null",
      },
    ]);
  });
});
