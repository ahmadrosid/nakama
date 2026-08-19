export const CLOUDFLARE_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
] as const;

export type CloudflareModel = (typeof CLOUDFLARE_MODELS)[number];

export function cloudflareModelSupportsThinking(
  _model: string,
  _customModels?: { id: string }[]
): boolean {
  return false;
}
