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

  it("orders required parameters first, then alphabetically, whatever the schema order", () => {
    // Built from an array rather than an object literal on purpose: the
    // formatter sorts literal keys alphabetically, which would make both
    // fixtures identical and leave this test asserting nothing.
    const schemaDeclaring = (declarationOrder: string[]) => ({
      properties: Object.fromEntries(
        declarationOrder.map((name) => [name, { type: "string" }])
      ),
      required: ["target", "cursor"],
      type: "object",
    });
    const names = (declarationOrder: string[]) =>
      parseMcpToolParameters(schemaDeclaring(declarationOrder)).map(
        (parameter) => parameter.name
      );

    const declarationOrder = ["zeta", "alpha", "target", "cursor"];
    const expected = ["cursor", "target", "alpha", "zeta"];

    expect(names(declarationOrder)).toEqual(expected);
    expect(names([...declarationOrder].reverse())).toEqual(expected);
  });
});
