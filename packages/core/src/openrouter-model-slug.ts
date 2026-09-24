/** OpenRouter model ids use `vendor/model` (optional `~`, `:variant` / `.` segments). */
export const OPENROUTER_MODEL_SLUG_PATTERN = /^~?[\w.-]+\/[\w.:-]+$/;

export function isOpenRouterModelSlug(model: string): boolean {
  return OPENROUTER_MODEL_SLUG_PATTERN.test(model.trim());
}
