function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (
    matches?.flatMap((part) => {
      const trimmed = part.trim();
      return trimmed ? [trimmed] : [];
    }) ?? [paragraph]
  );
}

export function splitThinkingLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines: string[] = [];

  for (const part of normalized.split(/\n{2,}/)) {
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      continue;
    }

    if (trimmedPart.includes("\n")) {
      for (const line of trimmedPart.split("\n")) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          lines.push(trimmedLine);
        }
      }
      continue;
    }

    const sentences = splitSentences(trimmedPart);
    if (sentences.length > 1) {
      lines.push(...sentences);
      continue;
    }

    lines.push(trimmedPart);
  }

  return lines;
}
