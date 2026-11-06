/**
 * Which thinking effort levels a model accepts, shared by the server (which
 * clamps the request) and the web app (which decides what the picker offers).
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

// Levels above "high" per model family, from each vendor's API docs. Vendors
// disagree on aliases (DeepSeek reads xhigh as high, Cloudflare as max), so
// nakama clamps before sending instead of relying on them.
// A static id table. OpenRouter's `supported_efforts` could replace it if it drifts.
const EXTRA_EFFORTS_BY_MODEL: [RegExp, ExtraThinkingEffort[]][] = [
  [/^claude-(opus|sonnet)-4[.-]6/, ["max"]],
  [
    /^claude-(opus-4[.-][78]|opus-5|sonnet-5|haiku-5|fable|mythos)/,
    ["xhigh", "max"],
  ],
  [/^gpt-5[.-][2-5]/, ["xhigh"]],
  [/^gpt-(5[.-][6-9]|6)/, ["xhigh", "max"]],
  [/^grok-4[.-][6-9]/, ["xhigh"]],
  [/^(deepseek-v4|deepseek-flash|(zai-)?glm-5[.-][2-9]|kimi-k3)/, ["max"]],
];

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return THINKING_EFFORTS.some((effort) => effort === value);
}

/** Levels above "high" the model accepts; low, medium and high are implied. */
export function extraThinkingEfforts(model: string): ExtraThinkingEffort[] {
  const id = model.trim().toLowerCase().split("/").at(-1) ?? "";

  return (
    EXTRA_EFFORTS_BY_MODEL.find(([pattern]) => pattern.test(id))?.[1] ?? []
  );
}

/** The highest level the model accepts that is not above `effort`. */
export function clampThinkingEffort(
  effort: ThinkingEffort,
  model: string
): ThinkingEffort {
  if (effort !== "xhigh" && effort !== "max") {
    return effort;
  }

  const extra = extraThinkingEfforts(model);

  if (extra.includes(effort)) {
    return effort;
  }

  return effort === "max" && extra.includes("xhigh") ? "xhigh" : "high";
}
