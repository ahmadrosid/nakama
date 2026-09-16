/** Suggestions only: nothing is remembered until the user chooses it. */
export function helpSuggestionsForContext(context: string): string[] {
  if (!context.trim()) {
    return [];
  }
  const suggestions: string[] = [];
  for (const [pattern, suggestion] of [
    [
      /\b(software|developer|engineering|engineer|coding|programmer)\b/i,
      "Writing code",
    ],
    [/\b(product|founder|startup|business|leader)\b/i, "Product decisions"],
    [/\b(design|designer|ux|ui)\b/i, "Design feedback"],
    [/\b(student|study|studying|learning|teacher)\b/i, "Learning concepts"],
    [/\b(research|researcher|data|analysis)\b/i, "Research and analysis"],
    [/\b(writer|writing|content|marketing|sales)\b/i, "Writing and editing"],
  ] as const) {
    if (pattern.test(context)) {
      suggestions.push(suggestion);
    }
  }
  return [
    ...new Set([
      ...suggestions,
      "Planning my work",
      "Brainstorming ideas",
      "Writing and editing",
    ]),
  ].slice(0, 3);
}
