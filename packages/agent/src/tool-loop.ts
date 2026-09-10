import type { ToolCall, ToolContext, ToolDefinition } from "@nakama/core";
import * as core from "@nakama/core";

export function canRunToolCallsInParallel(
  tools: ToolDefinition[],
  toolCalls: ToolCall[]
): boolean {
  if (toolCalls.length <= 1) {
    return false;
  }

  return toolCalls.every(
    (call) =>
      tools.find((tool) => tool.name === call.name)?.parallelSafe === true
  );
}

export async function executeToolCall(
  tools: ToolDefinition[],
  call: ToolCall,
  context: ToolContext = {}
): Promise<unknown> {
  const tool = tools.find((item) => item.name === call.name);

  if (!tool) {
    return { error: `Unknown tool: ${call.name}` };
  }

  try {
    const result = await tool.run(call.arguments, context);
    // The single place every tool result passes through, so the optimiser is
    // wired once rather than per tool. It returns `result` untouched unless it
    // is enabled, recognises the tool, and produces something strictly shorter.
    try {
      return await core.distillToolResult(call.name, result, context);
    } catch (error) {
      // Distillation is best-effort: never replace a successful tool result with
      // an optimiser failure (same shape as a tool-runtime error).
      console.warn(
        `distillToolResult failed for ${call.name}; returning raw result:`,
        error instanceof Error ? error.message : error
      );
      return result;
    }
  } catch (error) {
    context.signal?.throwIfAborted();
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A fresh tool set per user turn; discovery never widens profile assignments. */
export function createTurnTools(assigned: ToolDefinition[]): ToolDefinition[] {
  const deferred = assigned.filter(
    (tool) => tool.discoveryGroup && !tool.hosted
  );
  const active = assigned.filter((tool) => !tool.discoveryGroup || tool.hosted);
  if (!deferred.length) {
    return active;
  }
  let name = "find_tools";
  while (assigned.some((tool) => tool.name === name)) {
    name += "_plugins";
  }
  const catalog = new Map<string, string[]>();
  for (const tool of deferred) {
    const group = tool.discoveryGroup!;
    const actions = catalog.get(group) ?? [];
    actions.push(tool.name.replace(`plugin_${group}__`, ""));
    catalog.set(group, actions);
  }
  active.push({
    description: `Find and load assigned plugin tools before calling them. Search by plugin or action name. Loaded tools remain available for this user request only. Catalog: ${[...catalog].map(([group, actions]) => `${group}: ${actions.join(", ")}`).join("; ")}`,
    name,
    parameters: {
      additionalProperties: false,
      properties: { query: { maxLength: 500, minLength: 1, type: "string" } },
      required: ["query"],
      type: "object",
    },
    async run(input, context) {
      context.signal?.throwIfAborted();
      if (
        !input ||
        typeof input !== "object" ||
        !("query" in input) ||
        typeof input.query !== "string" ||
        !input.query.trim() ||
        input.query.length > 500
      ) {
        return { error: "Provide a query containing a plugin or action name." };
      }
      const terms = input.query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (term) =>
            term.length > 1 &&
            ![
              "the",
              "and",
              "for",
              "tools",
              "tool",
              "plugin",
              "please",
            ].includes(term)
        );
      const normalize = (term: string) => term.replace(/s$/, "");
      const groups = [...new Set(deferred.map((tool) => tool.discoveryGroup!))];
      const requestedGroups = groups.filter((group) =>
        group
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .some((word) =>
            terms.some((term) => normalize(term) === normalize(word))
          )
      );
      const groupTerms = new Set(
        requestedGroups.flatMap((group) =>
          group
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map(normalize)
        )
      );
      const actionTerms = terms.filter(
        (term) => !groupTerms.has(normalize(term))
      );
      const matches = deferred
        .filter(
          (tool) =>
            !requestedGroups.length ||
            requestedGroups.includes(tool.discoveryGroup!)
        )
        .map((tool) => {
          const words = tool.name
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map(normalize);
          const score = actionTerms.length
            ? actionTerms.filter((term) => words.includes(normalize(term)))
                .length
            : requestedGroups.length
              ? 1
              : 0;
          return { score, tool };
        })
        .filter((entry) => entry.score > 0)
        .sort(
          (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)
        );
      // Repeating a broad query loads the next batch instead of getting stuck.
      const unloaded = matches.filter(
        ({ tool }) => !active.some((entry) => entry.name === tool.name)
      );
      const selected = (unloaded.length ? unloaded : matches)
        .slice(0, 5)
        .map(({ tool }) => tool);
      for (const tool of selected) {
        if (!active.some((entry) => entry.name === tool.name)) {
          active.push(tool);
        }
      }
      return {
        remaining: Math.max(0, unloaded.length - selected.length),
        tools: selected.map((tool) => ({
          description: tool.description,
          name: tool.name,
        })),
      };
    },
  });
  return active;
}
