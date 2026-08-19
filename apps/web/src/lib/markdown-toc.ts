export type MarkdownHeading = {
  level: number;
  /**
   * Nth heading carrying this exact text. Scripts repeat titles ("Hook", "CTA"),
   * so the jump target is resolved by text plus occurrence, not by text alone.
   */
  occurrence: number;
  text: string;
};

/** A single heading is the document title, not an outline worth its own chrome. */
export const MARKDOWN_TOC_MIN_HEADINGS = 2;

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
/** 4+ leading spaces is an indented code block, so the hash is not a heading. */
const HEADING_PATTERN = /^ {0,3}(#{1,3}) +(.*)$/;

function plainMarkdownText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const seen = new Map<string, number>();
  let openFence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fence = FENCE_PATTERN.exec(line);

    if (fence) {
      const marker = fence[1][0];
      if (openFence === null) {
        openFence = marker;
      } else if (openFence === marker) {
        openFence = null;
      }
      continue;
    }

    if (openFence !== null) {
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (!heading) {
      continue;
    }

    const text = plainMarkdownText(heading[2]);
    if (!text) {
      continue;
    }

    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    headings.push({ level: heading[1].length, occurrence, text });
  }

  return headings;
}

/**
 * The rendered markdown is the source of truth for where a heading landed, so the
 * entry is matched back to its element by text rather than an injected anchor id.
 */
export function findHeadingElement(
  root: HTMLElement | null,
  heading: MarkdownHeading
): HTMLElement | null {
  if (!root) {
    return null;
  }

  const matches = Array.from(
    root.querySelectorAll<HTMLElement>("h1, h2, h3")
  ).filter((element) => element.textContent?.trim() === heading.text);

  return matches[heading.occurrence] ?? null;
}
