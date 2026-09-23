import type { PluginExecutionContext } from "@nakama/core";

export function run(
  input: unknown,
  context: PluginExecutionContext & {
    host(request: unknown): Promise<unknown>;
  }
): Promise<unknown> {
  if (!context.webActor) {
    throw new Error("Authenticated web access required");
  }
  return context.host({ input, op: "postgresql" });
}
