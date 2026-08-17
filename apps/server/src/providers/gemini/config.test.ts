import { describe, expect, test } from "bun:test";
import { buildGeminiChatConfig, sanitizeGeminiToolParameters } from "./config";

describe("sanitizeGeminiToolParameters", () => {
  test("maps integer exclusiveMinimum to inclusive minimum", () => {
    expect(
      sanitizeGeminiToolParameters({
        exclusiveMinimum: 0,
        maximum: 200,
        type: "integer",
      })
    ).toEqual({
      maximum: 200,
      minimum: 1,
      type: "integer",
    });
  });

  test("maps integer exclusiveMaximum to inclusive maximum", () => {
    expect(
      sanitizeGeminiToolParameters({
        exclusiveMaximum: 10,
        minimum: 0,
        type: "integer",
      })
    ).toEqual({
      maximum: 9,
      minimum: 0,
      type: "integer",
    });
  });

  test("keeps an existing inclusive bound instead of overwriting it", () => {
    expect(
      sanitizeGeminiToolParameters({
        exclusiveMinimum: 0,
        minimum: 5,
        type: "integer",
      })
    ).toEqual({
      minimum: 5,
      type: "integer",
    });
  });

  test("drops $schema and recurses into properties and items", () => {
    const sanitized = sanitizeGeminiToolParameters({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: {
        limit: {
          exclusiveMinimum: 0,
          type: "integer",
        },
        offsets: {
          items: {
            exclusiveMinimum: 0,
            type: "integer",
          },
          type: "array",
        },
        path: { type: "string" },
      },
      required: ["path"],
      type: "object",
    } as never);

    expect(sanitized).toEqual({
      additionalProperties: false,
      properties: {
        limit: {
          minimum: 1,
          type: "integer",
        },
        offsets: {
          items: {
            minimum: 1,
            type: "integer",
          },
          type: "array",
        },
        path: { type: "string" },
      },
      required: ["path"],
      type: "object",
    });
    expect(JSON.stringify(sanitized)).not.toContain("exclusiveMinimum");
    expect(JSON.stringify(sanitized)).not.toContain("$schema");
  });
});

describe("buildGeminiChatConfig tool sanitization", () => {
  test("strips exclusiveMinimum from function declaration parameters", () => {
    const config = buildGeminiChatConfig(
      {
        tools: [
          {
            description: "Read a file",
            name: "read_file",
            parameters: {
              properties: {
                offset: {
                  exclusiveMinimum: 0,
                  type: "integer",
                },
                path: { type: "string" },
              },
              type: "object",
            } as never,
          },
        ],
      },
      "system",
      "gemini-2.5-flash"
    );

    const tools = config.tools ?? [];
    const declarations = tools[0]?.functionDeclarations ?? [];
    const parameters = declarations[0]?.parameters;

    expect(JSON.stringify(parameters)).not.toContain("exclusiveMinimum");
    expect(parameters).toMatchObject({
      properties: {
        offset: {
          minimum: 1,
          type: "integer",
        },
        path: { type: "string" },
      },
      type: "object",
    });
  });
});
