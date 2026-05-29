import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileExists } from "../file-exists";
import type { LoadedSoulStack, SoulFileStatus, SoulStatus } from "./types";

const SOUL_FILES = {
  soul: "SOUL.md",
  style: "STYLE.md",
  skill: "SKILL.md",
  memory: "MEMORY.md",
} as const;

async function readOptionalFile(path: string): Promise<string | undefined> {
  if (!(await fileExists(path))) {
    return undefined;
  }

  const content = (await readFile(path, "utf8")).trim();
  return content || undefined;
}

async function loadExamples(directory: string): Promise<string | undefined> {
  const examplesDir = join(directory, "examples");

  if (!(await fileExists(examplesDir))) {
    return undefined;
  }

  const entries = await readdir(examplesDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  if (markdownFiles.length === 0) {
    return undefined;
  }

  const sections: string[] = [];

  for (const filename of markdownFiles) {
    const content = (await readFile(join(examplesDir, filename), "utf8")).trim();

    if (content) {
      sections.push(`## ${filename}\n\n${content}`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export async function loadSoulStack(directory: string): Promise<LoadedSoulStack> {
  const files: LoadedSoulStack["files"] = {};
  const loaded: string[] = [];

  for (const [key, filename] of Object.entries(SOUL_FILES)) {
    const content = await readOptionalFile(join(directory, filename));

    if (content) {
      files[key as keyof typeof SOUL_FILES] = content;
      loaded.push(filename);
    }
  }

  const examples = await loadExamples(directory);

  if (examples) {
    files.examples = examples;
    loaded.push("examples/");
  }

  return { directory, files, loaded };
}

export function toSoulStatus(stack: LoadedSoulStack): SoulStatus {
  const files: SoulFileStatus = {
    soul: Boolean(stack.files.soul),
    style: Boolean(stack.files.style),
    skill: Boolean(stack.files.skill),
    memory: Boolean(stack.files.memory),
    examples: Boolean(stack.files.examples),
  };

  return {
    directory: stack.directory,
    active: stack.loaded.length > 0,
    files,
  };
}

export async function getSoulStatus(directory: string): Promise<SoulStatus> {
  const stack = await loadSoulStack(directory);
  return toSoulStatus(stack);
}
