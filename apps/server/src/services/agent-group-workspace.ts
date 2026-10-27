import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import {
  getGroupMemoryPath,
  getGroupSharedDir,
  NakamaApiError,
} from "@nakama/core";
import type { AgentGroupMemoryChange } from "@nakama/core/agent-groups";
import type { GroupDocument } from "./agent-group-store";

/** A posted attachment: a document's text, or an image not saved yet. */
export type PostedDocument =
  | GroupDocument
  | { filename: string; image: Buffer };

/** Longest memory members see, the same cap as a profile's MEMORY.md. */
export const GROUP_MEMORY_CHARS = 4096;

/** An entry is one "- fact" line; this is its fact, on one line. */
function factOf(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^\s*[-*]\s*/, "")
    .trim();
}

/**
 * Everything a group keeps on disk: the shared folder its agents write to,
 * pasted images under shared/uploads, and memory.md beside the folder. Built
 * from the shared folder, which is what a group turn carries.
 */
export function groupWorkspace(sharedDir: string) {
  const memoryPath = getGroupMemoryPath(sharedDir);

  const readMemory = () =>
    existsSync(memoryPath) ? readFileSync(memoryPath, "utf8").trim() : "";

  const writeMemory = (content: string) => {
    const trimmed = content.trim();

    mkdirSync(dirname(memoryPath), { recursive: true });
    writeFileSync(memoryPath, trimmed ? `${trimmed}\n` : "");
  };

  return {
    memory: {
      /**
       * An agent's save: adds `entry` as a fact, or with `replaces` swaps that
       * entry for it, or removes that entry when `entry` is empty. A repeat is
       * skipped. Synchronous, so two turns in the same process cannot
       * interleave and drop an entry. `change` is set only when memory.md was
       * written, so the chat can show exactly what moved.
       */
      addFact(entry: string, replaces = "") {
        const memory = readMemory();
        const fact = factOf(entry);
        const target = factOf(replaces);
        const lines = memory ? memory.split("\n") : [];
        const index = lines.findIndex((line) => factOf(line) === target);

        if (target && index < 0) {
          throw new Error(
            "No entry in the group memory matches `replaces`. Copy it exactly."
          );
        }

        if (!(target || fact)) {
          throw new Error("entry is required.");
        }

        if (!target && lines.some((line) => factOf(line) === fact)) {
          return { change: undefined, memory };
        }

        const next = target
          ? fact
            ? lines.with(index, `- ${fact}`)
            : lines.toSpliced(index, 1)
          : [...lines, `- ${fact}`];

        const content = next.join("\n");

        if (content === memory) {
          return { change: undefined, memory };
        }

        // Memory the user wrote past the cap may still shrink.
        if (
          content.length > GROUP_MEMORY_CHARS &&
          content.length > memory.length
        ) {
          throw new Error(
            `The group memory is full (${GROUP_MEMORY_CHARS} characters). Replace or remove an entry first.`
          );
        }

        writeMemory(content);

        return {
          change: {
            newEntry: fact ? `- ${fact}` : null,
            oldEntry: target ? (lines[index] ?? null) : null,
          } satisfies AgentGroupMemoryChange,
          memory: readMemory(),
        };
      },

      /** The memory cut at the cap on a full line, as members see it. */
      forPrompt(): string {
        const memory = readMemory();

        if (memory.length <= GROUP_MEMORY_CHARS) {
          return memory;
        }

        const head = memory.slice(0, GROUP_MEMORY_CHARS);

        // Cut at the last full line, so no fact is half shown; one line past the cap is cut where it is.
        const lastLineEnd =
          memory[GROUP_MEMORY_CHARS] === "\n"
            ? head.length
            : head.lastIndexOf("\n");

        return `${lastLineEnd > 0 ? head.slice(0, lastLineEnd) : head}\n[truncated]`;
      },
      /** The group's memory, or "" when it has none. */
      read: readMemory,

      /**
       * The user's save of the whole memory. `base` is what their editor opened;
       * when an agent saved a fact since, the save is refused instead of dropping it.
       */
      replace(content: string, base: string): string {
        if (readMemory() !== base.trim()) {
          throw new NakamaApiError(
            "The group memory changed since you opened it. Reload it and try again.",
            409
          );
        }

        writeMemory(content);

        return readMemory();
      },
    },
    /** The shared folder, created on first use. */
    open(): string {
      mkdirSync(sharedDir, { recursive: true });

      return sharedDir;
    },

    /** Removes the shared folder and the memory, for a deleted group. */
    remove(): void {
      rmSync(dirname(sharedDir), { force: true, recursive: true });
    },

    /** Removes saved images, given their paths in the shared folder. */
    removeImages(paths: string[]): void {
      const uploads = join(sharedDir, "uploads");

      for (const path of paths) {
        const file = resolve(sharedDir, path);

        // Only what saveImages wrote; a stored path never leaves uploads/.
        if (dirname(file) === uploads) {
          rmSync(file, { force: true });
        }
      }
    },

    /**
     * Saves a valid post's images under shared/uploads; the agents get each
     * one's path to open with read_file.
     */
    saveImages(posted: PostedDocument[]): GroupDocument[] {
      return posted.map((document) => {
        if (!("image" in document)) {
          return document;
        }

        const path = `uploads/${randomUUID().slice(0, 8)}${extname(document.filename) || ".png"}`;

        mkdirSync(join(sharedDir, "uploads"), { recursive: true });
        writeFileSync(join(sharedDir, path), document.image);

        return {
          filename: document.filename,
          path,
          text: `Image saved at ${join(sharedDir, path)}. Open it with read_file to see it.`,
        };
      });
    },
  };
}

/** The workspace of a group in an org. */
export function workspaceOfGroup(orgId: string, groupId: string) {
  return groupWorkspace(getGroupSharedDir(orgId, groupId));
}
