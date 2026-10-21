import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DiscoveredSkill,
  JsonSchema,
  ToolContext,
  ToolDefinition,
} from "@nakama/core";
import { pathExists } from "@nakama/core";
import { z } from "zod";
import {
  type CustomToolRecord,
  loadCustomSubprocessTool,
  readOptionalString,
  resolveCustomToolModulePath,
} from "./custom-tool-shared";
import { spawnJsonTool } from "./custom-tool-subprocess";

const BUN_BIN = process.env.NAKAMA_BUN_BIN ?? "bun";

const customToolJsonValueSchema = z.json();

type CustomToolJsonValue = z.infer<typeof customToolJsonValueSchema>;

const javascriptSyntaxChecker = new Bun.Transpiler({ loader: "js" });

const syntaxErrorPositionSchema = z.object({
  position: z.object({ column: z.number(), line: z.number() }),
});

const RUNNER_PATH = fileURLToPath(
  new URL("./javascript-tool-runner.js", import.meta.url)
);

export async function loadJavascriptTool(
  record: CustomToolRecord,
  sharedContext?: ToolContext
): Promise<ToolDefinition | null> {
  return loadCustomSubprocessTool({
    allowParallelSafe: true,
    record,
    resolveModulePath: resolveCustomToolModulePath,
    run: (modulePath, input, context, env) =>
      runJavascriptTool(
        modulePath,
        input,
        context,
        env,
        Boolean(sharedContext)
      ),
    validateModule: validateJavascriptToolModule,
  });
}

/** Caller must verify published code against approved source files before loading. */
export async function loadJavascriptSkillTool(
  skill: DiscoveredSkill,
  context: ToolContext
): Promise<ToolDefinition | null> {
  const modulePath = skill.toolPath;

  if (!modulePath) {
    return null;
  }

  const metadata = z
    .object({
      description: z.string().optional(),
      name: z.string().optional(),
      parameters: z.record(z.string(), z.json()).optional(),
    })
    .parse(
      await spawnJsonTool({
        args: [RUNNER_PATH, modulePath, "--describe-skill"],
        bin: BUN_BIN,
        context,
        cwd: context.workspaceRoot!,
        input: {},
        label: "JavaScript skill tool",
        transport: { includeConfigDir: false },
        workspaceRoot: context.workspaceRoot,
      })
    );

  return {
    description: metadata.description?.trim() || skill.description,
    name: metadata.name?.trim() || skill.name,
    // SAFETY: The metadata schema confirms a JSON object before exposing it as JSON Schema.
    parameters: (metadata.parameters as JsonSchema | undefined) ?? {
      additionalProperties: true,
      type: "object",
    },
    async run(input, executionContext) {
      return spawnJsonTool({
        args: [RUNNER_PATH, modulePath, "--run-skill"],
        bin: BUN_BIN,
        context: executionContext,
        cwd: executionContext.workspaceRoot!,
        input: {
          context: {
            orgId: executionContext.orgId,
            orgRole: executionContext.orgRole,
            profileId: executionContext.profileId,
          },
          input: customToolJsonValueSchema.parse(input),
        },
        label: "JavaScript skill tool",
        transport: { includeConfigDir: false },
        workspaceRoot: executionContext.workspaceRoot,
      });
    },
  };
}

export async function validateJavascriptToolModule(
  modulePath: string,
  orgId?: string | null
): Promise<void> {
  const resolvedPath = resolveCustomToolModulePath(modulePath, orgId);

  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Tool module not found: ${modulePath}`);
  }

  // Static checks catch the obvious authoring failures before registration.
  const source = await readFile(resolvedPath, "utf8");

  // A parse in this process costs far less than an agent turn spent finding a
  // syntax error some other way: bash cannot reach the tools directory.
  try {
    javascriptSyntaxChecker.scan(source);
  } catch (error) {
    const position = syntaxErrorPositionSchema.safeParse(error).data?.position;

    const where = position
      ? ` at line ${position.line}:${position.column}`
      : "";

    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(`Syntax error in ${modulePath}${where}: ${reason}`);
  }

  if (
    !/\bexport\s+(?:async\s+)?function\s+run\s*\(|\bexport\s+(?:const|let|var)\s+run\s*=/.test(
      source
    )
  ) {
    throw new Error("Tool module must export a run(input, context) function.");
  }
}

async function runJavascriptTool<T>(
  modulePath: string,
  input: T,
  context: ToolContext,
  env?: Record<string, string>,
  shared = false
): Promise<CustomToolJsonValue> {
  // No try/catch here on purpose: a failed spawn must reject so the retry
  // policy in withToolRetries can retry explicitly opt-in transient failures
  // (RetryableToolError / exit 75). executeToolCall converts the throw into
  // `{ error: message }`.
  const cwd = shared ? context.workspaceRoot : path.dirname(modulePath);

  if (!cwd) {
    throw new Error("Shared tool workspace is unavailable.");
  }

  const result = await spawnJsonTool({
    args: [RUNNER_PATH, modulePath],
    bin: BUN_BIN,
    context,
    cwd,
    env,
    input: customToolJsonValueSchema.parse(input),
    label: "JavaScript tool",
    transport: shared ? { includeConfigDir: false } : undefined,
    workspaceRoot: readOptionalString(context?.workspaceRoot),
  });

  return customToolJsonValueSchema.parse(result);
}
