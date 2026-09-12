import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  derivePluginToolName,
  getOrgPluginDatabasePath,
  getOrgPluginDataDir,
  getPluginReleaseDir,
  getPluginStagingRootDir,
  getPluginsRootDir,
  PLUGIN_MANIFEST_API_VERSION,
  PLUGIN_TOOL_NAME_MAX_LENGTH,
  resolvePluginReleaseEntry,
  validatePluginJsonInstance,
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
  test("preserves an optional HTTPS icon", () => {
    const icon = "https://example.com/plugin.svg";
    const result = validatePluginManifest({
      ...identity,
      apiVersion: 1,
      icon,
      minNakamaVersion: "0.1.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toHaveProperty("icon", icon);
    }
  });

  test.each([
    "",
    123,
    "javascript:alert(1)",
    "file:///tmp/icon.png",
    "http://example.com/icon.png",
    "/icon.png",
  ])("rejects invalid icon %s", (icon) => {
    expect(
      validatePluginManifest({
        ...identity,
        apiVersion: 1,
        icon,
        minNakamaVersion: "0.1.0",
      }).ok
    ).toBe(false);
  });
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
        entryModule: "ui/index.js",
        pageLabel: "Notes",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.ui?.pageLabel).toBe("Notes");
    }
  });

  test("UI entrypoints must be JavaScript modules", () => {
    for (const [entryModule, accepted] of [
      ["ui/app.mjs", true],
      ["ui/index.html", false],
      ["../app.js", false],
    ] as const) {
      expect(
        validatePluginManifest({
          ...identity,
          apiVersion: PLUGIN_MANIFEST_API_VERSION,
          minNakamaVersion: "0.1.0",
          ui: { assetsDir: "ui", entryModule, pageLabel: "Notes" },
        }).ok
      ).toBe(accepted);
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

  test("rejects unsupported lifecycle hooks", () => {
    expect(
      validatePluginManifest({
        ...identity,
        apiVersion: PLUGIN_MANIFEST_API_VERSION,
        hooks: { activate: "hooks/activate.js" },
        minNakamaVersion: "0.1.0",
      })
    ).toEqual({ code: "unsupported_hooks", ok: false });
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

describe("validatePluginJsonInstance", () => {
  test("accepts supported types, enums, required, items, and bounds", () => {
    const schema = {
      additionalProperties: false,
      properties: {
        count: { exclusiveMaximum: 10, exclusiveMinimum: 0, type: "integer" },
        empty: { type: "null" },
        flag: { type: "boolean" },
        name: {
          enum: ["a", "b"],
          maxLength: 20,
          minLength: 1,
          type: "string",
        },
        tags: {
          items: { type: "string" },
          maxItems: 3,
          minItems: 1,
          type: "array",
        },
      },
      required: ["name"],
      type: "object",
    };

    expect(
      validatePluginJsonInstance(schema, {
        count: 1,
        empty: null,
        flag: true,
        name: "a",
        tags: ["x"],
      }).ok
    ).toBe(true);
  });

  test("defaults additionalProperties to true and rejects extras when false", () => {
    expect(
      validatePluginJsonInstance(
        { properties: { name: { type: "string" } }, type: "object" },
        { extra: true, name: "a" }
      ).ok
    ).toBe(true);
    expect(
      validatePluginJsonInstance(
        {
          additionalProperties: false,
          properties: { name: { type: "string" } },
          type: "object",
        },
        { extra: true, name: "a" }
      ).ok
    ).toBe(false);
  });

  test("rejects missing required fields, wrong types, and out-of-range values", () => {
    expect(
      validatePluginJsonInstance(
        {
          properties: { name: { type: "string" } },
          required: ["name"],
          type: "object",
        },
        {}
      ).ok
    ).toBe(false);
    expect(validatePluginJsonInstance({ type: "integer" }, 1.5).ok).toBe(false);
    expect(
      validatePluginJsonInstance({ maximum: 3, minimum: 1, type: "number" }, 0)
        .ok
    ).toBe(false);
    expect(
      validatePluginJsonInstance({ enum: ["a"], type: "string" }, "b").ok
    ).toBe(false);
  });
});

describe("plugin package paths", () => {
  test("resolves release and staging dirs from the config root", () => {
    const configDir = "/tmp/nakama-config";
    expect(getPluginsRootDir(configDir)).toBe(join(configDir, "plugins"));
    expect(getPluginReleaseDir("notes", "1.0.0", configDir)).toBe(
      join(configDir, "plugins", "notes", "1.0.0")
    );
    expect(getPluginStagingRootDir(configDir)).toBe(
      join(configDir, "plugins", ".staging")
    );
    expect(getOrgPluginDataDir("org_a", "notes", configDir)).toBe(
      join(configDir, "orgs", "org_a", "plugins", "notes")
    );
    expect(getOrgPluginDatabasePath("org_a", "notes", "gen_1", configDir)).toBe(
      join(configDir, "orgs", "org_a", "plugins", "notes", "db", "gen_1.sqlite")
    );
    expect(
      resolvePluginReleaseEntry(
        join(configDir, "plugins", "notes", "1.0.0"),
        "actions/list.js"
      )
    ).toBe(join(configDir, "plugins", "notes", "1.0.0", "actions", "list.js"));
  });

  test("rejects relative config dirs and unsafe identity segments", () => {
    expect(() => getPluginReleaseDir("notes", "1.0.0", "relative")).toThrow();
    expect(() =>
      getPluginReleaseDir("../notes", "1.0.0", "/tmp/nakama-config")
    ).toThrow();
    expect(() =>
      getPluginReleaseDir("notes", "1.0.0/../2", "/tmp/nakama-config")
    ).toThrow();
    expect(() =>
      getOrgPluginDataDir("../org", "notes", "/tmp/nakama-config")
    ).toThrow();
    expect(() =>
      resolvePluginReleaseEntry(
        "/tmp/nakama-config/plugins/notes/1.0.0",
        "../x.js"
      )
    ).toThrow();
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
