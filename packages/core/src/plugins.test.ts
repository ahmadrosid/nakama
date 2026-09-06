import { describe, expect, test } from "bun:test";
import {
  derivePluginToolName,
  PLUGIN_MANIFEST_API_VERSION,
  PLUGIN_TOOL_NAME_MAX_LENGTH,
  validatePluginJsonSchema,
  validatePluginManifest,
} from "./plugins";

const identity = {
  author: "Nakama",
  description: "Notes for an organization",
  id: "notes",
  license: "MIT",
  name: "Notes",
  version: "1.0.0",
};

describe("validatePluginManifest", () => {
  test("accepts a skills-only manifest", () => {
    const result = validatePluginManifest({
      apiVersion: PLUGIN_MANIFEST_API_VERSION,
      minNakamaVersion: "0.1.0",
      ...identity,
      skills: [{ directory: "skills/notes", key: "notes" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.skills).toEqual([
        { directory: "skills/notes", key: "notes" },
      ]);
      expect(result.manifest.actions).toEqual([]);
    }
  });

  test("accepts a UI-only manifest", () => {
    const result = validatePluginManifest({
      apiVersion: PLUGIN_MANIFEST_API_VERSION,
      minNakamaVersion: "0.1.0",
      ...identity,
      ui: {
        assetsDir: "ui/assets",
        entryHtml: "ui/index.html",
        pageLabel: "Notes",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.ui?.pageLabel).toBe("Notes");
    }
  });

  test("accepts an action-only manifest", () => {
    const result = validatePluginManifest({
      apiVersion: PLUGIN_MANIFEST_API_VERSION,
      minNakamaVersion: "0.1.0",
      ...identity,
      actions: [
        {
          access: "member",
          description: "List notes",
          effect: "read",
          entry: "actions/list.js",
          exposeAsTool: true,
          inputSchema: {
            properties: {
              limit: { maximum: 100, minimum: 1, type: "integer" },
            },
            required: [],
            type: "object",
          },
          key: "list",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.actions).toHaveLength(1);
      expect(result.manifest.actions[0]?.key).toBe("list");
    }
  });

  test("rejects invalid package and API versions", () => {
    expect(
      validatePluginManifest({
        apiVersion: 2,
        minNakamaVersion: "0.1.0",
        ...identity,
        skills: [{ directory: "skills/notes", key: "notes" }],
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        skills: [{ directory: "skills/notes", key: "notes" }],
        version: "v1.0.0",
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "latest",
        ...identity,
        skills: [{ directory: "skills/notes", key: "notes" }],
      }).ok
    ).toBe(false);
  });

  test("rejects duplicate contribution keys", () => {
    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        skills: [
          { directory: "skills/a", key: "notes" },
          { directory: "skills/b", key: "notes" },
        ],
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        actions: [
          {
            access: "member",
            description: "A",
            effect: "read",
            entry: "actions/a.js",
            inputSchema: { type: "object" },
            key: "list",
          },
          {
            access: "member",
            description: "B",
            effect: "read",
            entry: "actions/b.js",
            inputSchema: { type: "object" },
            key: "list",
          },
        ],
      }).ok
    ).toBe(false);
  });

  test("rejects unsupported schemas and remote refs", () => {
    const baseAction = {
      access: "member" as const,
      description: "List notes",
      effect: "read" as const,
      entry: "actions/list.js",
      key: "list",
    };

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        actions: [
          {
            ...baseAction,
            inputSchema: { $ref: "https://example.com/schema.json" },
          },
        ],
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        actions: [
          {
            ...baseAction,
            inputSchema: {
              allOf: [{ type: "object" }],
              type: "object",
            },
          },
        ],
      }).ok
    ).toBe(false);
  });

  test("rejects missing capability fields", () => {
    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        skills: [{ key: "notes" }],
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        ui: { pageLabel: "Notes" },
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        actions: [
          {
            description: "List notes",
            entry: "actions/list.js",
            key: "list",
          },
        ],
      }).ok
    ).toBe(false);
  });

  test("rejects undeclared executable skill entrypoints", () => {
    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        skills: [
          {
            directory: "skills/notes",
            entrypoint: "skills/notes/tool.js",
            key: "notes",
          },
        ],
      }).ok
    ).toBe(false);
  });

  test("rejects malformed identity and traversal paths", () => {
    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        id: "Notes Plugin",
        skills: [{ directory: "skills/notes", key: "notes" }],
      }).ok
    ).toBe(false);

    expect(
      validatePluginManifest({
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        minNakamaVersion: "0.1.0",
        ...identity,
        skills: [{ directory: "../outside", key: "notes" }],
      }).ok
    ).toBe(false);
  });
});

describe("validatePluginJsonSchema", () => {
  test("accepts the supported subset", () => {
    expect(
      validatePluginJsonSchema({
        additionalProperties: false,
        items: { type: "string" },
        properties: {
          count: { maximum: 10, minimum: 0, type: "integer" },
          empty: { type: "null" },
          flag: { type: "boolean" },
          name: {
            enum: ["a", "b"],
            maxLength: 20,
            minLength: 1,
            type: "string",
          },
        },
        required: ["name"],
        type: "object",
      }).ok
    ).toBe(true);
  });

  test("rejects unsupported keywords", () => {
    expect(validatePluginJsonSchema({ $ref: "#/defs/x" }).ok).toBe(false);
    expect(validatePluginJsonSchema({ anyOf: [{ type: "string" }] }).ok).toBe(
      false
    );
    expect(validatePluginJsonSchema({ pattern: "^x" }).ok).toBe(false);
  });
});

describe("derivePluginToolName", () => {
  test("namespaces action keys from the plugin id", () => {
    expect(derivePluginToolName("notes", "list")).toBe("plugin_notes__list");
    expect(derivePluginToolName("org-notes", "create-item")).toBe(
      "plugin_org_notes__create_item"
    );
  });

  test("rejects names beyond the provider limit", () => {
    const longKey = "k".repeat(PLUGIN_TOOL_NAME_MAX_LENGTH);
    expect(derivePluginToolName("notes", longKey)).toBeNull();
  });
});
