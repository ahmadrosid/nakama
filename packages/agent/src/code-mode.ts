import type { ToolContext, ToolDefinition } from "@nakama/core";
import { getQuickJS } from "@tootallnate/quickjs-emscripten";
import Ajv from "ajv";
import { z } from "zod";
import { executeToolCall } from "./tool-loop";

const MAX_CODE_BYTES = 16_384;

const MAX_INPUT_BYTES = 16_384;

const MAX_CHILD_BYTES = 65_536;

const MAX_OUTPUT_BYTES = 16_384;

const MAX_CALLS = 12;

const MAX_CATALOG = 64;

const MAX_READS = 4;

const TIMEOUT_MS = 8000;

const MEMORY_BYTES = 16 * 1024 * 1024;

const SAFE_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type Child = {
  tool: ToolDefinition;
  validate: (value: unknown) => value is Record<string, JsonValue>;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/* oxlint-disable anti-slop/no-runtime-typeof -- These checks reject non-JSON data before it crosses the VM boundary. */
function isJsonData(value: unknown): value is JsonValue {
  const seen = new Set<object>();

  const check = (item: unknown, depth: number): item is JsonValue => {
    if (depth > 32) {
      throw new Error("Data is too deep.");
    }

    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      return true;
    }

    if (typeof item === "number" && Number.isFinite(item)) {
      return true;
    }

    if (typeof item !== "object" || seen.has(item)) {
      throw new Error("Only JSON data is allowed.");
    }

    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new Error("Only JSON data is allowed.");
    }

    seen.add(item);

    if (Reflect.ownKeys(item).some((key) => typeof key !== "string")) {
      throw new Error("Only JSON data is allowed.");
    }

    if (
      Array.isArray(item) &&
      Object.keys(item).some((key, index) => key !== String(index))
    ) {
      throw new Error("Only JSON data is allowed.");
    }

    if (Array.isArray(item) && Object.keys(item).length !== item.length) {
      throw new Error("Only JSON data is allowed.");
    }

    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error("Unsafe object key.");
      }

      const descriptor = Object.getOwnPropertyDescriptor(item, key);

      if (!(descriptor && "value" in descriptor)) {
        throw new Error("Only JSON data is allowed.");
      }

      check(child, depth + 1);
    }

    seen.delete(item);

    return true;
  };

  return check(value, 0);
}
/* oxlint-enable anti-slop/no-runtime-typeof */

function json(value: JsonValue, limit: number): string {
  const data = JSON.stringify(value);

  if (!data || Buffer.byteLength(data) > limit) {
    throw new Error("Data is too large.");
  }

  return data;
}

function catalogFor(tools: ToolDefinition[]): Map<string, Child> {
  const ajv = new Ajv({
    allErrors: false,
    strictSchema: true,
    validateSchema: true,
  });

  const result = new Map<string, Child>();
  const counts = new Map<string, number>();

  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }

  for (const tool of tools) {
    if (
      !(tool.codeModeEligible || tool.name === "search_files") ||
      tool.hosted ||
      !SAFE_NAME.test(tool.name) ||
      FORBIDDEN_KEYS.has(tool.name)
    ) {
      continue;
    }

    if (counts.get(tool.name) !== 1) {
      continue;
    }

    const schema = tool.parameters ?? {
      additionalProperties: false,
      properties: {},
      type: "object",
    };

    if (schema.type !== "object") {
      continue;
    }

    try {
      if (!isJsonData(schema)) {
        continue;
      }

      json(schema, 8192);
      const validate = ajv.compile(schema);
      result.set(tool.name, { tool, validate });
    } catch {
      // A schema the validator cannot enforce stays available as a direct tool.
    }

    if (result.size >= MAX_CATALOG) {
      break;
    }
  }

  return result;
}

export function createCodeModeTool(
  tools: ToolDefinition[],
  context: ToolContext
): ToolDefinition | null {
  if (
    !(
      context.orgId &&
      context.sessionId &&
      context.codeModeAudit?.begin &&
      context.codeModeAudit.complete
    ) ||
    context.automationRunId ||
    tools.some((tool) => tool.name === "execute")
  ) {
    return null;
  }

  const catalog = catalogFor(tools);

  if (!catalog.size) {
    return null;
  }

  const listing = [...catalog.values()].map(({ tool }) => ({
    description: tool.description.slice(0, 180),
    name: tool.name,
    parameters: tool.parameters ?? {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
  }));

  const preview = listing
    .slice(0, 8)
    .map(({ name, description }) => `${name}: ${description}`)
    .join("\n");

  return {
    description: `Run short JavaScript against assigned tools. Use tools["exact_name"]({input}) and search("text") to find exact names and schemas. Return JSON data. Child results stay outside chat history. Available tools:\n${preview}`,
    name: "execute",
    parameters: {
      additionalProperties: false,
      properties: {
        code: {
          description: "JavaScript body. Use return to send a result.",
          type: "string",
        },
      },
      required: ["code"],
      type: "object",
    },
    async run(input, callContext) {
      const parsedInput = z.object({ code: z.string() }).safeParse(input);
      const code = parsedInput.success ? parsedInput.data.code : null;

      if (code === null || Buffer.byteLength(code) > MAX_CODE_BYTES) {
        return { error: "Code is missing or too large." };
      }

      if (
        !(
          callContext.parentToolCallId &&
          callContext.codeModeAudit?.begin &&
          callContext.codeModeAudit.complete
        )
      ) {
        return { error: "Code mode audit is unavailable." };
      }

      return runCode(code, catalog, listing, callContext);
    },
  };
}

async function runCode(
  code: string,
  catalog: Map<string, Child>,
  listing: Array<{ name: string; description: string; parameters: unknown }>,
  context: ToolContext
): Promise<JsonValue> {
  const quickjs = await getQuickJS();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(MEMORY_BYTES);
  runtime.setMaxStackSize(256 * 1024);
  const controller = new AbortController();
  const deadline = Date.now() + TIMEOUT_MS;
  const abort = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener("abort", abort, { once: true });

  if (context.signal?.aborted) {
    abort();
  }

  const timer = setTimeout(
    () => controller.abort(new Error("Code mode timed out.")),
    TIMEOUT_MS
  );

  runtime.setInterruptHandler(
    () => controller.signal.aborted || Date.now() > deadline
  );
  const vm = runtime.newContext();
  const runId = crypto.randomUUID();
  let count = 0;
  let fatal: string | null = null;
  let childError: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let activeReads = 0;
  const readWaiters: Array<() => void> = [];
  const reads = new Set<Promise<unknown>>();
  const pending = new Set<Promise<unknown>>();
  const settlements = new Set<Promise<unknown>>();

  const schedule = (
    child: Child,
    task: () => Promise<string>
  ): Promise<string> => {
    if (child.tool.parallelSafe) {
      const run = (async () => {
        await tail;

        if (activeReads >= MAX_READS) {
          await new Promise<void>((resolve) => readWaiters.push(resolve));
        } else {
          activeReads += 1;
        }

        try {
          return await task();
        } finally {
          const next = readWaiters.shift();

          if (next) {
            next();
          } else {
            activeReads -= 1;
          }
        }
      })();

      reads.add(run);
      run.finally(() => reads.delete(run)).catch(() => {});

      return run;
    }

    const run = Promise.allSettled([tail, ...reads]).then(task);
    reads.clear();
    tail = run.catch(() => {});

    return run;
  };

  const bridge = vm.newFunction("__call", (nameHandle, inputHandle) => {
    const promise = vm.newPromise();
    const name = vm.getString(nameHandle);
    const raw = vm.getString(inputHandle);
    const child = catalog.get(name);
    const index = ++count;

    const work = (async () => {
      if (fatal) {
        throw new Error(fatal);
      }

      if (!child) {
        throw new Error("Tool is not in this session's code-mode catalog.");
      }

      if (index > MAX_CALLS) {
        throw new Error("Code mode call limit reached.");
      }

      if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) {
        throw new Error("Tool input is too large.");
      }

      const input: unknown = JSON.parse(raw);

      if (!isJsonData(input)) {
        throw new Error("Tool input is not JSON data.");
      }

      const safeInput = json(input, MAX_INPUT_BYTES);

      if (!child.validate(input)) {
        throw new Error("Tool input does not match its schema.");
      }

      return schedule(child, async () => {
        controller.signal.throwIfAborted();
        const id = `${context.parentToolCallId}:${runId}:${index}`;
        await context.codeModeAudit!.begin({
          id,
          input: safeInput,
          parentToolCallId: context.parentToolCallId!,
          startedAt: new Date().toISOString(),
          toolName: name,
        });
        let status: "completed" | "failed" | "unknown" | "media" = "completed";
        let output = "";

        try {
          controller.signal.throwIfAborted();

          const call = executeToolCall(
            [child.tool],
            { arguments: input, id, name },
            {
              ...context,
              codeModeChild: true,
              signal: controller.signal,
            },
            { raw: true }
          );

          const result = await new Promise<unknown>((resolve, reject) => {
            const onAbort = () =>
              reject(new Error("Tool outcome unknown after cancellation."));

            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
            call
              .then(resolve, reject)
              .finally(() =>
                controller.signal.removeEventListener("abort", onAbort)
              );
          });

          const mediaResult = z
            .object({ hasMedia: z.literal(true) })
            .passthrough()
            .safeParse(result);

          if (mediaResult.success) {
            status = "media";
            fatal = "Tool ran; its media result is not available in code mode.";
            controller.abort(new Error(fatal));
            throw new Error(fatal);
          }

          const wrappedResult = z
            .object({ hasMedia: z.boolean(), value: z.json().optional() })
            .passthrough()
            .safeParse(result);

          const value = wrappedResult.success
            ? wrappedResult.data.value
            : result;

          const errorResult = z
            .object({ error: z.json() })
            .passthrough()
            .safeParse(value);

          if (errorResult.success) {
            throw new Error(String(errorResult.data.error));
          }

          if (!isJsonData(value)) {
            throw new Error("Tool output is not JSON data.");
          }

          output = json(value, MAX_CHILD_BYTES);

          return output;
        } catch (error) {
          status =
            status === "media"
              ? "media"
              : controller.signal.aborted
                ? "unknown"
                : "failed";
          output =
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "Tool failed.";
          throw new Error(output);
        } finally {
          await context.codeModeAudit!.complete({
            completedAt: new Date().toISOString(),
            id,
            result: output.slice(0, MAX_CHILD_BYTES),
            status,
          });
        }
      });
    })();

    pending.add(work);

    const settlement = work
      .then(
        (value) => {
          const handle = vm.newString(value);
          promise.resolve(handle);
          handle.dispose();
        },
        (error) => {
          childError = error instanceof Error ? error.message : "Tool failed.";
          const handle = vm.newString(childError);
          promise.reject(handle);
          handle.dispose();
        }
      )
      .finally(() => pending.delete(work))
      .finally(() => {
        const jobs = runtime.executePendingJobs();

        if (jobs.error) {
          jobs.error.dispose();
        }
      });

    settlements.add(settlement);
    settlement.finally(() => settlements.delete(settlement)).catch(() => {});

    return promise.handle;
  });

  vm.setProp(vm.global, "__call", bridge);
  bridge.dispose();

  try {
    const setup = `const __catalog = JSON.parse(${JSON.stringify(JSON.stringify(listing))});
const search = (query) => __catalog.filter(x => x.name.includes(String(query)) || x.description.toLowerCase().includes(String(query).toLowerCase())).slice(0, 10);
const tools = Object.freeze(Object.fromEntries(__catalog.map(x => [x.name, (input = {}) => __call(x.name, JSON.stringify(input)) .then(JSON.parse)])));
(async () => { ${code}\n})()`;

    const evaluated = vm.evalCode(setup);

    if (evaluated.error) {
      const message = vm.dump(evaluated.error);
      evaluated.error.dispose();
      const errorMessage = z.object({ message: z.string() }).safeParse(message);
      throw new Error(
        errorMessage.success ? errorMessage.data.message : "Code failed."
      );
    }

    const handle = evaluated.value;
    let resolved;

    try {
      const resolution = vm.resolvePromise(handle);
      const jobs = runtime.executePendingJobs();

      if (jobs.error) {
        jobs.error.dispose();
      }

      resolved = await Promise.race([
        resolution,
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new Error("Code mode stopped."));
          } else {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("Code mode stopped.")),
              { once: true }
            );
          }
        }),
      ]);
    } finally {
      handle.dispose();
    }

    await Promise.allSettled([...pending]);
    await Promise.allSettled([...settlements]);

    if (resolved.error) {
      const message = vm.dump(resolved.error);
      resolved.error.dispose();
      const errorMessage = z.object({ message: z.string() }).safeParse(message);
      throw new Error(
        errorMessage.success ? errorMessage.data.message : "Code failed."
      );
    }

    const value: unknown = vm.dump(resolved.value);
    resolved.value.dispose();

    if (fatal) {
      throw new Error(fatal);
    }

    if (childError) {
      throw new Error(childError);
    }

    if (!isJsonData(value)) {
      throw new Error("Code output is not JSON data.");
    }

    return JSON.parse(json(value, MAX_OUTPUT_BYTES));
  } catch (error) {
    await Promise.allSettled([...pending]);
    await Promise.allSettled([...settlements]);

    return {
      error: (
        fatal ??
        childError ??
        (error instanceof Error ? error.message : "Code mode failed.")
      ).slice(0, 1000),
    };
  } finally {
    await Promise.allSettled([...settlements]);
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", abort);
    vm.dispose();
    runtime.dispose();
  }
}
