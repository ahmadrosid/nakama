import type { ChatListItem } from "@/lib/chat-history";

export interface LocalFileCitation {
  href: string;
  label: string;
  number: number;
  path: string;
}

export function formatLocalCitations(
  markdown: string,
  profileId?: string | null
) {
  const citations: LocalFileCitation[] = [];

  const formatted = markdown.replace(
    /(?<!!)\[([^\]]+)\]\(([^\s)]+)\)/g,
    (link, label: string, path: string) => {
      if (/^[a-z][a-z\d+.-]*:/i.test(path) || /^[/.#]/.test(path)) {
        return link;
      }

      if (!profileId) {
        return `${label} (\`${path}\`)`;
      }

      const existing = citations.find((citation) => citation.path === path);

      if (existing) {
        return `[${existing.number}](${existing.href})`;
      }

      const number = citations.length + 1;

      const query = new URLSearchParams({
        citation: String(number),
        file: path,
        profile: profileId,
      });

      const href = `#file-citation?${query}`;
      citations.push({ href, label, number, path });

      return `[${number}](${href})`;
    }
  );

  return { citations, markdown: formatted };
}

export function toolGroupElapsedSeconds(
  tools: ChatListItem[],
  now: number,
  active = false
): number | null {
  if (tools.length === 0) {
    return null;
  }

  let startedAt = Number.POSITIVE_INFINITY;
  let completedAt = Number.NEGATIVE_INFINITY;

  for (const tool of tools) {
    const start = tool.toolStartedAt;
    const end = tool.toolStatus === "running" ? now : tool.toolCompletedAt;

    if (
      start === undefined ||
      end === undefined ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start
    ) {
      return null;
    }

    startedAt = Math.min(startedAt, start);
    completedAt = Math.max(completedAt, end);
  }

  return Math.max(
    1,
    Math.floor(((active ? now : completedAt) - startedAt) / 1000)
  );
}

export type AssistantTurnSegment =
  | {
      groupId?: string;
      active?: boolean;
      kind: "work";
      thinking?: ChatListItem;
      tools: ChatListItem[];
    }
  | { kind: "text"; message: ChatListItem; thinking?: ChatListItem };

export function segmentAssistantTurn(
  messages: ChatListItem[],
  streamActive = false
): AssistantTurnSegment[] {
  const segments: AssistantTurnSegment[] = [];

  for (const message of messages) {
    if (
      message.role === "tool" ||
      (message.role === "assistant" && hasThinkingContent(message))
    ) {
      const previous = segments.at(-1);

      const work: Extract<AssistantTurnSegment, { kind: "work" }> =
        previous?.kind === "work"
          ? previous
          : {
              groupId: message.id,
              kind: "work",
              tools: [],
            };

      if (work !== previous) {
        segments.push(work);
      }

      if (message.role === "tool") {
        work.tools.push(message);

        if (work.thinking) {
          work.thinking = { ...work.thinking, thinkingStreaming: false };
        }
      } else {
        const prior = work.thinking;
        work.thinking = prior
          ? {
              ...message,
              createdAt: prior.createdAt,
              id: prior.id,
              thinking: [prior.thinking, message.thinking]
                .filter(Boolean)
                .join("\n\n"),
              thinkingDurationMs:
                prior.thinkingDurationMs !== undefined &&
                message.thinkingDurationMs !== undefined
                  ? prior.thinkingDurationMs + message.thinkingDurationMs
                  : undefined,
            }
          : message;
      }
    }

    if (message.role === "assistant" && hasAssistantText(message)) {
      segments.push({ kind: "text", message });
    }
  }

  const latestWork = segments.findLast((segment) => segment.kind === "work");

  if (latestWork?.kind === "work") {
    latestWork.active = streamActive;
  }

  const toolUrls = collectToolUrls(messages);

  if (toolUrls.length === 0) {
    return segments;
  }

  return segments.map((segment) => {
    if (segment.kind !== "text") {
      return segment;
    }

    const content = repairCopiedToolUrls(segment.message.content, toolUrls);

    return content === segment.message.content
      ? segment
      : { ...segment, message: { ...segment.message, content } };
  });
}

// Models sometimes drop or change a few characters when they copy a long
// signed URL from a tool result. The broken copy then fails (403, 404).
// Short URLs are left alone: a small change there is likely on purpose.
const MIN_REPAIRED_URL_LENGTH = 120;

const MAX_URL_COPY_EDITS = 16;

function collectToolUrls(messages: ChatListItem[]): string[] {
  const urls = new Set<string>();

  for (const message of messages) {
    if (message.role !== "tool" || message.toolResult == null) {
      continue;
    }

    // A string result is quoted too; the URL pattern stops at the escapes.
    const text = JSON.stringify(message.toolResult);

    for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
      urls.add(match[0]);
    }
  }

  return [...urls];
}

function repairCopiedToolUrls(markdown: string, toolUrls: string[]): string {
  const known = new Set(toolUrls);

  return markdown.replace(/https?:\/\/[^\s"'<>()[\]`]+/g, (url) => {
    if (url.length < MIN_REPAIRED_URL_LENGTH || known.has(url)) {
      return url;
    }

    const base = urlBase(url);
    let best: string | null = null;
    let bestDistance = MAX_URL_COPY_EDITS + 1;

    for (const candidate of toolUrls) {
      if (urlBase(candidate) !== base) {
        continue;
      }

      const distance = boundedEditDistance(url, candidate, bestDistance - 1);

      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return best ?? url;
  });
}

function urlBase(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

/** Levenshtein distance, or `limit + 1` once it is sure to be over `limit`. */
function boundedEditDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) {
    return limit + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );

      current.push(value);
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > limit) {
      return limit + 1;
    }

    previous = current;
  }

  return previous[b.length] ?? limit + 1;
}

function hasThinkingContent(message: ChatListItem): boolean {
  return Boolean(message.thinking?.trim() || message.thinkingStreaming);
}

function hasAssistantText(message: ChatListItem): boolean {
  // Empty streaming bubbles are handled by the awaiting-model placeholder, not as text.
  // Failed markers always render even when the error string is the only content.
  return Boolean(message.content.trim() || message.failed);
}
