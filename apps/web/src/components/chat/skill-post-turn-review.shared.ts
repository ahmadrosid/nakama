import type { SkillSuggestion } from "@nakama/core/contract";

/** Prefer YAML frontmatter description; fall back to a short body excerpt. */
export function skillSuggestionPreview(suggestion: SkillSuggestion): {
  title: string;
  description: string;
  excerpt: string | null;
} {
  const title =
    suggestion.action === "create"
      ? `Create skill “${suggestion.skillName}”`
      : `Update skill “${suggestion.skillName}”`;

  if (suggestion.action === "patch") {
    const oldPart = (suggestion.patchOldString ?? "").trim();
    const newPart = (suggestion.patchNewString ?? "").trim();
    const excerpt =
      oldPart || newPart
        ? `Replace:\n${truncate(oldPart, 180)}\n\nWith:\n${truncate(newPart, 180)}`
        : null;
    return {
      description: "Suggested improvement from this chat turn.",
      excerpt,
      title,
    };
  }

  const content = suggestion.content ?? "";
  const description =
    extractSkillDescription(content) ??
    "Suggested new skill from this chat turn.";
  const excerpt = truncate(stripFrontmatter(content), 280) || null;
  return { description, excerpt, title };
}

export function extractSkillDescription(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }
  for (const line of match[1]!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith("description:")) {
      continue;
    }
    const value = trimmed
      .slice("description:".length)
      .trim()
      .replace(/^["']|["']$/g, "");
    return value || null;
  }
  return null;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
