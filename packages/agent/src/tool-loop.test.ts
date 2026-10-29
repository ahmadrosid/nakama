import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "@nakama/core";
import {
  canRunToolCallsInParallel,
  createTurnTools,
  executeToolCall,
} from "./tool-loop";

const sampleTool: ToolDefinition = {
  description: "Sample tool for tests",
  name: "sample",
  parameters: {
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
    type: "object",
  },
  run(input) {
    return Promise.resolve(input);
  },
};

describe("tool-loop", () => {
  test("canRunToolCallsInParallel requires more than one parallelSafe tool", () => {
    const parallelTool: ToolDefinition = { ...sampleTool, parallelSafe: true };

    const sequentialTool: ToolDefinition = {
      ...sampleTool,
      name: "sequential",
    };

    expect(
      canRunToolCallsInParallel(
        [parallelTool],
        [{ arguments: {}, id: "1", name: "sample" }]
      )
    ).toBe(false);
    expect(
      canRunToolCallsInParallel(
        [parallelTool],
        [
          { arguments: {}, id: "1", name: "sample" },
          { arguments: {}, id: "2", name: "sample" },
        ]
      )
    ).toBe(true);
    expect(
      canRunToolCallsInParallel(
        [parallelTool, sequentialTool],
        [
          { arguments: {}, id: "1", name: "sample" },
          { arguments: {}, id: "2", name: "sequential" },
        ]
      )
    ).toBe(false);
  });

  test("executeToolCall returns an error for unknown tools", async () => {
    const result = await executeToolCall([sampleTool], {
      arguments: {},
      id: "call_2",
      name: "missing",
    });

    expect(result).toEqual({ error: "Unknown tool: missing" });
  });

  test("executeToolCall catches handler errors", async () => {
    const failingTool: ToolDefinition = {
      description: "Always fails",
      name: "fail",
      async run() {
        throw new Error("boom");
      },
    };

    const result = await executeToolCall([failingTool], {
      arguments: {},
      id: "call_3",
      name: "fail",
    });

    expect(result).toEqual({ error: "boom" });
  });

  test("executeToolCall drops undefined fields like JSON serialization", async () => {
    const optionalTool: ToolDefinition = {
      ...sampleTool,
      async run() {
        return { message: "kept", placeholder: undefined };
      },
    };

    const result = await executeToolCall([optionalTool], {
      arguments: {},
      id: "optional",
      name: "sample",
    });

    expect(result).toEqual({ message: "kept" });
  });

  test("executeToolCall re-throws the cancellation reason", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled");

    const cancellingTool: ToolDefinition = {
      description: "Cancels its turn",
      name: "cancel",
      parameters: { properties: {}, type: "object" },
      async run() {
        controller.abort(cancellation);
        throw new Error("tool failed while cancelling");
      },
    };

    const pending = executeToolCall(
      [cancellingTool],
      {
        arguments: {},
        id: "call_5",
        name: "cancel",
      },
      { signal: controller.signal }
    );

    await expect(pending).rejects.toBe(cancellation);
  });
});

describe("createTurnTools", () => {
  test("checks discovery access before loading a tool and cancels without widening the session", async () => {
    const discovered = new Set<string>();
    let checked = 0;
    const controller = new AbortController();

    const assigned: ToolDefinition[] = [
      {
        ...sampleTool,
        async canDiscover() {
          checked += 1;

          return false;
        },
        discoveryGroup: "office",
        discoveryScope: "session",
        name: "office__read",
      },
      {
        ...sampleTool,
        async canDiscover() {
          controller.abort();

          return true;
        },
        discoveryGroup: "office",
        discoveryScope: "session",
        name: "office__write",
      },
    ];

    const active = createTurnTools(assigned, discovered);
    const search = active[0]!;
    expect(await search.run({ query: "read office" }, {})).toEqual({
      remaining: 0,
      tools: [],
    });
    expect(checked).toBe(1);
    await expect(
      search.run({ query: "write office" }, { signal: controller.signal })
    ).rejects.toThrow();
    expect(discovered.size).toBe(0);
    expect(active.map((tool) => tool.name)).toEqual(["find_tools"]);
  });

  test("discovery is bounded to assignments, validates input, and does not execute tools", async () => {
    let calls = 0;

    const plugin = {
      ...sampleTool,
      discoveryGroup: "notes",
      name: "plugin_notes__list",
      async run() {
        calls++;

        return {};
      },
    };

    const assigned = [sampleTool, plugin];
    const active = createTurnTools(assigned);
    const discovery = active.find((tool) => tool.name === "find_tools")!;
    expect(await discovery.run({}, {})).toHaveProperty("error");
    expect(await discovery.run({ query: " ".repeat(501) }, {})).toHaveProperty(
      "error"
    );
    expect(await discovery.run({ query: "x".repeat(501) }, {})).toHaveProperty(
      "error"
    );
    expect(
      await discovery.run({ extra: true, query: "notes" }, {})
    ).toHaveProperty("error");
    expect(await discovery.run({ query: "unassigned" }, {})).toEqual({
      remaining: 0,
      tools: [],
    });
    await discovery.run({ query: "notes" }, {});
    await discovery.run({ query: "notes" }, {});
    expect(active.filter((tool) => tool.name === plugin.name)).toHaveLength(1);
    expect(calls).toBe(0);
    expect(assigned).toHaveLength(2);
    expect(createTurnTools(assigned)).toHaveLength(2);
    const controller = new AbortController();
    controller.abort();
    await expect(
      discovery.run({ query: "notes" }, { signal: controller.signal })
    ).rejects.toThrow();
  });
  test("does not add discovery without deferred tools or shadow an assigned tool", () => {
    expect(createTurnTools([sampleTool])).toEqual([sampleTool]);
    const existing = { ...sampleTool, name: "find_tools" };

    const deferred = {
      ...sampleTool,
      discoveryGroup: "notes",
      name: "plugin_notes__list",
    };

    expect(
      createTurnTools([existing, deferred]).map((tool) => tool.name)
    ).toEqual(["find_tools", "find_tools_plugins"]);
  });
});

test("the discovery catalog says what each plugin holds", () => {
  const assigned = ["list_sheets", "read_sheet"].map((action) => ({
    ...sampleTool,
    discoveryGroup: "data_view",
    discoveryHint: "Spreadsheet copies",
    name: `plugin_data_view__${action}`,
  }));

  const [discovery] = createTurnTools([
    ...assigned,
    { ...sampleTool, discoveryGroup: "notes", name: "plugin_notes__list" },
  ]);

  expect(discovery?.description).toContain(
    // oxlint-disable-next-line anti-slop/no-copy-assertions -- The catalog text is what the model reads; the hint must reach it.
    "data_view (Spreadsheet copies): list_sheets, read_sheet"
  );
  // oxlint-disable-next-line anti-slop/no-copy-assertions -- A plugin without a hint keeps the plain entry.
  expect(discovery?.description).toContain("notes: list");
});

test("plugin search supports multiple actions and paginates broad group queries", async () => {
  const assigned = ["create", "update", "list", "run", "delete", "inspect"].map(
    (action) => ({
      ...sampleTool,
      discoveryGroup: "workflows",
      name: `plugin_workflows__${action}_workflow`,
    })
  );

  const active = createTurnTools(assigned);
  const discovery = active[0]!;

  // SAFETY: This discovery input returns named tools in this test fixture.
  const result = (await discovery.run(
    { query: "list and run workflows" },
    {}
  )) as { tools: Array<{ name: string }> };

  expect(result.tools.map((tool) => tool.name)).toEqual([
    "plugin_workflows__list_workflow",
    "plugin_workflows__run_workflow",
  ]);
  const other = createTurnTools(assigned);
  expect(await other[0]!.run({ query: "workflows" }, {})).toHaveProperty(
    "remaining",
    1
  );
  await other[0]!.run({ query: "workflows" }, {});
  expect(other).toHaveLength(7);
});
