/**
 * Split streaming markdown into completed blocks (safe to render as markdown)
 * and a trailing incomplete tail (render as plain text).
 *
 * Only treats blank lines outside fenced code blocks as seal boundaries, so a
 * fence that contains blank lines stays in the tail until the fence closes.
 */
export function splitStreamingMarkdown(content: string): {
  sealed: string;
  tail: string;
} {
  if (!content) {
    return { sealed: "", tail: "" };
  }

  let inFence = false;
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  let lastSealedEnd = 0;

  let index = 0;
  const length = content.length;

  while (index < length) {
    const newlineAt = content.indexOf("\n", index);
    const lineEnd = newlineAt === -1 ? length : newlineAt;
    const line = content.slice(index, lineEnd);

    const fence = line.match(/^(\s*)([`~]{3,})(.*)$/);
    if (fence) {
      const marker = fence[2]!;
      const char = marker[0] as "`" | "~";
      const info = fence[3] ?? "";
      if (!inFence) {
        inFence = true;
        fenceChar = char;
        fenceLen = marker.length;
      } else if (
        char === fenceChar &&
        marker.length >= fenceLen &&
        info.trim() === ""
      ) {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
    } else if (!inFence && line.trim() === "" && index > 0) {
      lastSealedEnd = newlineAt === -1 ? lineEnd : newlineAt + 1;
    }

    if (newlineAt === -1) {
      break;
    }
    index = newlineAt + 1;
  }

  if (lastSealedEnd <= 0) {
    return { sealed: "", tail: content };
  }

  return {
    sealed: content.slice(0, lastSealedEnd),
    tail: content.slice(lastSealedEnd),
  };
}
