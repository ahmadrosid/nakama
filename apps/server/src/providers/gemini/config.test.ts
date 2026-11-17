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
    });

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
            },
          },
        ],
      },
      "system",
      "gemini-2.5-flash"
    );

    const tools = config.tools ?? [];
    const functionTool = tools.find((tool) => "functionDeclarations" in tool);

    if (!(functionTool && "functionDeclarations" in functionTool)) {
      throw new Error("Expected function declarations");
    }

    const declarations = functionTool.functionDeclarations ?? [];
    const parameters = declarations[0]?.parametersJsonSchema;
    expect(declarations[0]?.parameters).toBeUndefined();

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

describe("buildGeminiChatConfig enum members", () => {
  function declaredParameters(enumValues: string[]) {
    const config = buildGeminiChatConfig(
      {
        tools: [
          {
            description: "Plan a trial",
            name: "plan_trial",
            parameters: {
              properties: {
                graduationStrategy: { enum: enumValues, type: "string" },
              },
              type: "object",
            },
          },
        ],
      },
      "system",
      "gemini-2.5-flash"
    );

    const functionTool = (config.tools ?? []).find(
      (tool) => "functionDeclarations" in tool
    );

    if (!(functionTool && "functionDeclarations" in functionTool)) {
      throw new Error("Expected function declarations");
    }

    return functionTool.functionDeclarations?.[0]?.parametersJsonSchema;
  }

  test("drops empty enum members that Gemini rejects", () => {
    expect(declaredParameters(["", "auto"])).toEqual({
      properties: {
        graduationStrategy: { enum: ["auto"], type: "string" },
      },
      type: "object",
    });
  });

  test("drops an enum that only holds an empty string", () => {
    expect(declaredParameters([""])).toEqual({
      properties: { graduationStrategy: { type: "string" } },
      type: "object",
    });
  });
});
