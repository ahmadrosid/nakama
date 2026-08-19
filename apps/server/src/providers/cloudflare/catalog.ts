import type { ProviderModelOption } from "../models";

/**
 * Cloudflare Workers AI model catalog.
 * Model IDs use the @cf/ prefix format.
 * Docs: https://developers.cloudflare.com/workers-ai/models/
 *
 * Free tier: @cf/meta/llama-3.1-8b-instruct and @cf/meta/llama-3.1-8b-instruct-fast
 * are free to use with a Cloudflare account.
 */
export const CLOUDFLARE_MODELS: ProviderModelOption[] = [
  {
    contextWindow: 128_000,
    default: true,
    id: "@cf/meta/llama-3.1-8b-instruct",
    inputPerMillionUsd: 0,
    maxOutputTokens: 4096,
    name: "Llama 3.1 8B",
    outputPerMillionUsd: 0,
    provider: "cloudflare",
    supportsVision: false,
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    inputPerMillionUsd: 0,
    maxOutputTokens: 4096,
    name: "Llama 3.1 8B (Fast)",
    outputPerMillionUsd: 0,
    provider: "cloudflare",
    supportsVision: false,
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.1-70b-instruct",
    inputPerMillionUsd: 0.59,
    maxOutputTokens: 4096,
    name: "Llama 3.1 70B",
    outputPerMillionUsd: 0.79,
    provider: "cloudflare",
    supportsVision: false,
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.3-70b-instruct",
    inputPerMillionUsd: 0.59,
    maxOutputTokens: 4096,
    name: "Llama 3.3 70B",
    outputPerMillionUsd: 0.79,
    provider: "cloudflare",
    supportsVision: false,
  },
  {
    contextWindow: 32_000,
    id: "@cf/qwen/qwen1.5-14b-chat-awq",
    inputPerMillionUsd: 0.19,
    maxOutputTokens: 4096,
    name: "Qwen 1.5 14B",
    outputPerMillionUsd: 0.29,
    provider: "cloudflare",
    supportsVision: false,
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.1-8b-instruct-awq",
    inputPerMillionUsd: 0,
    maxOutputTokens: 4096,
    name: "Llama 3.1 8B (AWQ)",
    outputPerMillionUsd: 0,
    provider: "cloudflare",
    supportsVision: false,
  },
];
