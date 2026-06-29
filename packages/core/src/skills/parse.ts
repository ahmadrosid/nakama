import type { ParsedSkillFile, SkillFrontmatter } from "./types";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMarkdown(
  content: string,
  sourcePath: string,
): ParsedSkillFile {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(`Skill file is empty: ${sourcePath}`);
  }

  const match = trimmed.match(FRONTMATTER_PATTERN);

  if (!match) {
    throw new Error(`Skill file must start with YAML frontmatter: ${sourcePath}`);
  }

  const frontmatter = parseFrontmatter(match[1]!, sourcePath);
  const body = match[2]!.trim();

  return {
    frontmatter,
    body,
    sourcePath,
  };
}

function parseFrontmatter(raw: string, sourcePath: string): SkillFrontmatter {
  const fields = new Map<string, string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    fields.set(key, stripQuotes(value));
  }

  const rawName = fields.get("name")?.trim() ?? "";
  const description = fields.get("description")?.trim() ?? "";

  if (!rawName) {
    throw new Error(`Skill frontmatter requires name: ${sourcePath}`);
  }

  if (!description) {
    throw new Error(`Skill frontmatter requires description: ${sourcePath}`);
  }

  const name = validateSkillName(rawName, sourcePath);

  return {
    name,
    description,
    disableModelInvocation: parseBooleanField(fields.get("disable-model-invocation")),
    includeBodyOnMatch: parseBooleanField(fields.get("include-body-on-match")),
  };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseBooleanField(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return undefined;
}

function validateSkillName(name: string, sourcePath: string): string {
  const normalized = name.toLowerCase();

  if (!/^[a-z0-9-]{1,64}$/.test(normalized)) {
    throw new Error(
      `Skill name must be lowercase letters, numbers, or hyphens (max 64 chars): ${sourcePath}`,
    );
  }

  return normalized;
}
