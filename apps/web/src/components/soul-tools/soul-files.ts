import type { SoulStackFiles } from "@nakama/core/contract";

export const SOUL_FILES = [
  {
    key: "soul" as const,
    label: "SOUL.md",
    description: "Identity, worldview, and opinions",
    writable: true,
  },
  {
    key: "style" as const,
    label: "STYLE.md",
    description: "Voice, tone, and formatting",
    writable: true,
  },
  {
    key: "instructions" as const,
    label: "INSTRUCTIONS.md",
    description: "Operating instructions and workflows",
    writable: true,
  },
  {
    key: "memory" as const,
    label: "MEMORY.md",
    description: "Continuity and context to carry forward",
    writable: true,
  },
] satisfies Array<{
  key: keyof SoulStackFiles;
  label: string;
  description: string;
  writable: boolean;
}>;
