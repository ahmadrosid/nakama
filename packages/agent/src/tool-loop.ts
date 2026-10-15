import type { ToolCall, ToolContext, ToolDefinition } from "@nakama/core";

import * as core from "@nakama/core";

import { z } from "zod";

const ToolResultSchema = z.json();

const DiscoveryInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
  })
  .strict();

export type ToolResult = z.infer<typeof ToolResultSchema>;

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
): Promise<ToolResult> {
  const tool = tools.find((item) => item.name === call.name);

  if (!tool) {
    return { error: `Unknown tool: ${call.name}` };
  }

  try {
    // Check what the model and the transcript receive: the JSON-serialized
    // value, so optional fields left undefined are dropped, not rejected.
    const result = ToolResultSchema.parse(
      JSON.parse(JSON.stringify(await tool.run(call.arguments, context)))
    );

    // The single place every tool result passes through, so the optimiser is
    // wired once rather than per tool. It returns `result` untouched unless it
    // is enabled, recognises the tool, and produces something strictly shorter.
    try {
      return ToolResultSchema.parse(
        JSON.parse(
          JSON.stringify(
            await core.distillToolResult(call.name, result, context)
          )
        )
      );
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

/** Discovery never widens assignments; only session-scoped tools survive a turn. */
export function createTurnTools(
  assigned: ToolDefinition[],
  discovered = new Set<string>()
): ToolDefinition[] {
  const deferred = assigned.filter(
    (tool) => tool.discoveryGroup && !tool.hosted
  );

  const active = assigned.filter(
    (tool) =>
      !tool.discoveryGroup ||
      tool.hosted ||
      (tool.discoveryScope === "session" && discovered.has(tool.name))
  );

  if (!deferred.length) {
    return active;
  }

  const hasSessionDiscovery = deferred.some(
    (tool) => tool.discoveryScope === "session"
  );

  let name = "find_tools";

  while (assigned.some((tool) => tool.name === name)) {
    name += "_plugins";
  }

  const catalog = new Map<string, string[]>();

  for (const tool of deferred) {
    const group = tool.discoveryGroup!;
    const actions = catalog.get(group) ?? [];

    if (tool.discoveryScope !== "session") {
      actions.push(tool.name.replace(`plugin_${group}__`, ""));
    }

    catalog.set(group, actions);
  }

  active.push({
    description: hasSessionDiscovery
      ? `Find and load assigned tools before calling them. Search by server, plugin, action name, or MCP tool description. Plugin tools last for this request; MCP tools last for this session. Catalog: ${[...catalog].map(([group, actions]) => `${group}${actions.length ? `: ${actions.join(", ")}` : " (MCP)"}`).join("; ")}`
      : `Find and load assigned plugin tools before calling them. Search by plugin or action name. Loaded tools remain available for this user request only. Catalog: ${[...catalog].map(([group, actions]) => `${group}: ${actions.join(", ")}`).join("; ")}`,
    name,
    parameters: core.jsonSchemaFromZod(DiscoveryInputSchema),
    async run(input, context) {
      context.signal?.throwIfAborted();

      const parsedInput = DiscoveryInputSchema.safeParse(input);

      if (!parsedInput.success) {
        return {
          error: hasSessionDiscovery
            ? "Provide a query containing a server, plugin, or action name."
            : "Provide a query containing a plugin or action name.",
        };
      }

      const terms = parsedInput.data.query
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
              ...(hasSessionDiscovery ? ["mcp"] : []),
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
        .flatMap((tool) => {
          if (
            requestedGroups.length > 0 &&
            !(
              tool.discoveryGroup &&
              requestedGroups.includes(tool.discoveryGroup)
            )
          ) {
            return [];
          }

          const searchable =
            tool.discoveryScope === "session"
              ? `${tool.name} ${tool.description}`
              : tool.name;

          const words = searchable
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map(normalize);

          const score = actionTerms.length
            ? actionTerms.filter((term) => words.includes(normalize(term)))
                .length
            : requestedGroups.length
              ? 1
              : 0;

          return score > 0 ? [{ score, tool }] : [];
        })
        .sort(
          (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)
        );

      const available: typeof matches = [];

      for (const match of matches) {
        context.signal?.throwIfAborted();

        if (
          !match.tool.canDiscover ||
          (await match.tool.canDiscover(context))
        ) {
          available.push(match);
        }
      }

      context.signal?.throwIfAborted();

      // Repeating a broad query loads the next batch instead of getting stuck.
      const unloaded = available.filter(
        ({ tool }) => !active.some((entry) => entry.name === tool.name)
      );

      const selected = (unloaded.length ? unloaded : available)
        .slice(0, 5)
        .map(({ tool }) => tool);

      for (const tool of selected) {
        if (!active.some((entry) => entry.name === tool.name)) {
          active.push(tool);
        }

        if (tool.discoveryScope === "session") {
          discovered.add(tool.name);
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
