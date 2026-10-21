import type { ProfileSummary } from "@nakama/core";
import { type MentionRange, mentionRanges } from "@nakama/core/agent-groups";
import type { MessageResponseProps } from "@/components/ai-elements/message";

type MarkdownComponents = NonNullable<MessageResponseProps["components"]>;

const CODE_SPANS = /```[\s\S]*?```|`[^`\n]*`/g;

function MentionChip({
  profiles,
  range,
}: {
  profiles: ProfileSummary[];
  range: MentionRange;
}) {
  const profile = profiles.find((candidate) => candidate.id === range.id);

  return (
    <span
      className="align-baseline font-medium text-primary leading-snug"
      title={`@${range.handle}`}
    >
      @{profile?.name ?? range.handle}
    </span>
  );
}

/** Plain text with each member mention shown as a chip. */
export function MentionText({
  handles,
  profiles,
  text,
}: {
  handles: Map<string, string>;
  profiles: ProfileSummary[];
  text: string;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const range of mentionRanges(text, handles)) {
    parts.push(
      text.slice(cursor, range.start),
      <MentionChip key={range.start} profiles={profiles} range={range} />
    );
    cursor = range.end;
  }

  parts.push(text.slice(cursor));

  return parts;
}

/**
 * Wraps mentions outside code in `~~@handle~~`; `mentionMarkdownComponents`
 * renders those as chips. Strikethrough is the one inline mark the chat
 * markdown leaves free to override.
 */
export function markMentions(
  markdown: string,
  handles: Map<string, string>
): string {
  const code = [...markdown.matchAll(CODE_SPANS)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);

  let marked = "";
  let cursor = 0;

  for (const range of mentionRanges(markdown, handles)) {
    if (
      code.some(
        ([start = 0, end = 0]) => range.start >= start && range.start < end
      )
    ) {
      continue;
    }

    marked += `${markdown.slice(cursor, range.start)}~~@${range.handle}~~`;
    cursor = range.end;
  }

  return marked + markdown.slice(cursor);
}

export function mentionMarkdownComponents(
  handles: Map<string, string>,
  profiles: ProfileSummary[]
): MarkdownComponents {
  return {
    del: ({ children, node: _node, ...props }) => {
      // A mention marker holds only text, so anything else stays a plain del.
      const text = String(children);
      const [range] = mentionRanges(text, handles);

      return range && range.start === 0 && range.end === text.length ? (
        <MentionChip profiles={profiles} range={range} />
      ) : (
        <del {...props}>{children}</del>
      );
    },
  };
}
