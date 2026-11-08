/**
 * Which thinking effort levels a host and model accept, shared by the server
 * (which clamps the request) and the web app (which decides what the picker
 * offers).
 */

import type { ThinkingEffort } from "./contract";

export const THINKING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingEffort[];

type ExtraThinkingEffort = "xhigh" | "max";

// Hosts that pass the effort through to an API that takes these levels. The
// rest send no effort (OpenCode Go, Together), reject the higher values
// (Ollama), or are unknown endpoints, so they stop at high.
const EXTRA_EFFORT_HOSTS = new Set([
  "anthropic",
  "cerebras",
  "chatgpt",
  "deepseek",
  "fireworks",
  "netra",
  "openai",
  "openrouter",
  "xai_oauth",
]);

// Levels above "high" per model family, from each vendor's API docs. Vendors
// disagree on aliases (DeepSeek reads xhigh as high, Cloudflare as max), so
// nakama clamps before sending instead of relying on them.
// A static id table. OpenRouter's `supported_efforts` could replace it if it drifts.
const EXTRA_EFFORTS_BY_MODEL: readonly (readonly [
  RegExp,
  readonly ExtraThinkingEffort[],
])[] = [
  [/^claude-(opus|sonnet)-4[.-]6/, ["max"]],
  [
    /^claude-(opus-4[.-][78]|opus-5|sonnet-5|haiku-5|fable|mythos)/,
    ["xhigh", "max"],
  ],
  [/^gpt-5\.[2-5]/, ["xhigh"]],
  [/^gpt-(5\.[6-9]|6)/, ["xhigh", "max"]],
  [/^grok-4[.-][6-9]/, ["xhigh"]],
  [/^(deepseek-v4|deepseek-flash|(zai-)?glm-5[.p][2-9]|kimi-k3)/, ["max"]],
];

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return THINKING_EFFORTS.some((effort) => effort === value);
}

/** Levels above "high" the host and model accept; lower ones are implied. */
export function extraThinkingEfforts(
  model: string,
  provider: string
): readonly ExtraThinkingEffort[] {
  if (!EXTRA_EFFORT_HOSTS.has(provider)) {
    return [];
  }

  const id = model.trim().toLowerCase().split("/").at(-1) ?? "";

  return (
    EXTRA_EFFORTS_BY_MODEL.find(([pattern]) => pattern.test(id))?.[1] ?? []
  );
}

/** The highest level the host and model accept that is not above `effort`. */
export function clampThinkingEffort(
  effort: ThinkingEffort,
  model: string,
  provider: string
): ThinkingEffort {
  if (effort !== "xhigh" && effort !== "max") {
    return effort;
  }

  const extra = extraThinkingEfforts(model, provider);

  if (extra.includes(effort)) {
    return effort;
  }

  return effort === "max" && extra.includes("xhigh") ? "xhigh" : "high";
}
