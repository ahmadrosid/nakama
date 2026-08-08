import type { SoulStackFiles } from "@nakama/core/contract";

export const SOUL_FILES = [
  {
    description: "Identity, worldview, and opinions",
    key: "soul" as const,
    label: "SOUL.md",
    writable: true,
  },
  {
    description: "Voice, tone, and formatting",
    key: "style" as const,
    label: "STYLE.md",
    writable: true,
  },
  {
    description: "Operating instructions and workflows",
    key: "instructions" as const,
    label: "INSTRUCTIONS.md",
    writable: true,
  },
  {
    description: "Continuity and context to carry forward",
    key: "memory" as const,
    label: "MEMORY.md",
    writable: true,
  },
] satisfies Array<{
  key: keyof SoulStackFiles;
  label: string;
  description: string;
  writable: boolean;
}>;
