import type { LoadedSoulStack } from "./types";

export interface ComposeSoulPromptOptions {
  profilePrompt?: string;
}

export function composeSoulSystemPrompt(
  stack: LoadedSoulStack,
  options: ComposeSoulPromptOptions = {}
): string {
  const profilePrompt = options.profilePrompt?.trim();
  const sections: string[] = [
    "You embody the identity defined below. This is who you are — not a description of someone else.",
    "Stay in character. Extrapolate from worldview and voice when topics aren't explicitly covered.",
  ];

  if (stack.files.soul) {
    sections.push("", "# Identity (SOUL.md)", stack.files.soul);
  } else if (profilePrompt) {
    sections.push("", "# Identity", profilePrompt);
  }

  if (stack.files.style) {
    sections.push("", "# Voice & Style (STYLE.md)", stack.files.style);
  }

  if (stack.files.instructions) {
    sections.push(
      "",
      "# Operating Instructions (INSTRUCTIONS.md)",
      stack.files.instructions
    );
  }

  if (stack.files.memory) {
    sections.push("", "# Continuity (MEMORY.md)", stack.files.memory);
  }

  if (stack.files.soul && profilePrompt && profilePrompt !== stack.files.soul) {
    sections.push("", "# Profile Instructions", profilePrompt);
  }

  return sections.join("\n");
}
