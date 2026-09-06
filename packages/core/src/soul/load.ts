import { join } from "node:path";
import {
  pathExists,
  readDirectoryEntries,
  readText,
  readTextIfExists,
} from "../fs";
import type { LoadedSoulStack, SoulFileStatus, SoulStatus } from "./types";

export const SOUL_FILES = {
  instructions: "INSTRUCTIONS.md",
  memory: "MEMORY.md",
  soul: "SOUL.md",
  style: "STYLE.md",
} as const;

async function loadExamples(directory: string): Promise<string | undefined> {
  const examplesDir = join(directory, "examples");

  if (!(await pathExists(examplesDir))) {
    return;
  }

  const entries = await readDirectoryEntries(examplesDir);
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  if (markdownFiles.length === 0) {
    return;
  }

  const sections: string[] = [];

  for (const filename of markdownFiles) {
    const content = (await readText(join(examplesDir, filename))).trim();

    if (content) {
      sections.push(`## ${filename}\n\n${content}`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export async function loadSoulStack(
  directory: string
): Promise<LoadedSoulStack> {
  const files: LoadedSoulStack["files"] = {};
  const loaded: string[] = [];

  for (const [key, filename] of Object.entries(SOUL_FILES)) {
    const content = await readTextIfExists(join(directory, filename));

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
    examples: Boolean(stack.files.examples),
    instructions: Boolean(stack.files.instructions),
    memory: Boolean(stack.files.memory),
    soul: Boolean(stack.files.soul),
    style: Boolean(stack.files.style),
  };

  return {
    active: stack.loaded.length > 0,
    directory: stack.directory,
    files,
  };
}

export async function getSoulStatus(directory: string): Promise<SoulStatus> {
  const stack = await loadSoulStack(directory);
  return toSoulStatus(stack);
}
