import type { ProfileSummary } from "@nakama/core";
import type {
  AgentGroupMessage,
  AgentGroupRun,
} from "@nakama/core/agent-groups";
import { cn } from "@nakama/ui/utils";
import {
  Chat01Icon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  File01Icon,
} from "hugeicons-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MentionText,
  markMentions,
  mentionMarkdownComponents,
} from "@/components/agent-groups/group-mentions";
import {
  GroupMessageArtifacts,
  GroupMessageImage,
} from "@/components/agent-groups/group-message-files";
import {
  Conversation,
  ConversationScrollButton,
  ConversationStickinessProvider,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { shortenSharedPaths } from "@/lib/agent-group-panels";

/** Same threshold as the agent chat list. */
const AT_BOTTOM_PX = 80;

const ACTION_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Copy and reply, floated over the card's top right while it is hovered. */
function MessageActions({
  onReply,
  text,
}: {
  onReply: () => void;
  text: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="absolute top-0 right-3 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button
        aria-label={copied ? "Copied" : "Copy response"}
        className={ACTION_BUTTON}
        onClick={copy}
        title={copied ? "Copied" : "Copy response"}
        type="button"
      >
        {copied ? (
          <CheckmarkCircle01Icon aria-hidden className="size-4" />
        ) : (
          <Copy01Icon aria-hidden className="size-4" />
        )}
      </button>
      <button
        aria-label="Reply in thread"
        className={ACTION_BUTTON}
        onClick={onReply}
        title="Reply in thread"
        type="button"
      >
        <Chat01Icon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** Under the text once a thread has replies, or an agent is answering in it. */
function ThreadLink({
  onClick,
  replies,
  replying,
}: {
  onClick: () => void;
  replies: number;
  replying: boolean;
}) {
  if (replies === 0 && !replying) {
    return null;
  }

  return (
    <button
      className="ml-1 rounded text-left font-medium text-primary text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      {replying
        ? "Replying in thread…"
        : `${replies} ${replies === 1 ? "reply" : "replies"} in thread`}
    </button>
  );
}

/** A time label shows between messages this far apart. */
const TIME_GAP_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

/** "Today 8:36 AM", "Yesterday 12:35 PM", else "Oct 18, 12:35 PM". */
function timeLabel(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY_MS);

  if (days === 0) {
    return `Today ${time}`;
  }

  if (days === 1) {
    return `Yesterday ${time}`;
  }

  const day = date.toLocaleDateString([], { day: "numeric", month: "short" });

  return `${day}, ${time}`;
}

/**
 * A sent message first carries a temporary id, then the server's. Keying user
 * messages by their order keeps the swap from remounting (and flashing) them.
 */
function messageKeys(messages: AgentGroupMessage[]): string[] {
  let userCount = 0;

  return messages.map((message) =>
    message.authorProfileId === null
      ? `user-${userCount++}`
      : `message-${message.id}`
  );
}

/** The typing dots of the agent that is writing. */
function TypingRow({
  onOpenLive,
  speaker,
  speakerContinues,
  stopping,
}: {
  onOpenLive: () => void;
  speaker: ProfileSummary | undefined;
  speakerContinues: boolean;
  stopping: boolean;
}) {
  return (
    <div className="mt-3 flex items-end gap-2">
      {speaker ? (
        <ProfileAvatar className="outline-none" profile={speaker} size="sm" />
      ) : (
        <span className="size-7 shrink-0" />
      )}
      <div className="flex flex-col items-start gap-1">
        {speaker && !speakerContinues ? (
          <div className="px-3.5 text-muted-foreground text-xs">
            {speaker.name}
          </div>
        ) : null}
        <button
          aria-label={stopping ? "Stopping, watch live" : "Watch live"}
          className="flex h-9 cursor-pointer items-center gap-1 rounded-[1.25rem] rounded-bl-md bg-muted px-4 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpenLive}
          type="button"
        >
          {[0, 1, 2].map((dot) => (
            <span
              className="size-2 animate-bounce rounded-full bg-muted-foreground/60"
              key={dot}
              style={{ animationDelay: `${dot * 150}ms` }}
            />
          ))}
        </button>
      </div>
    </div>
  );
}

/** The group transcript, laid out and pinned to the bottom like agent chat. */
export function GroupMessageList({
  handles,
  messages,
  onOpenLive,
  onOpenThread,
  profiles,
  run,
  threadRunIds,
}: {
  handles: Map<string, string>;
  messages: AgentGroupMessage[];
  onOpenLive: () => void;
  onOpenThread: (messageId: number) => void;
  profiles: ProfileSummary[];
  run: AgentGroupRun | null;
  threadRunIds: number[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const markdownComponents = useMemo(
    () => mentionMarkdownComponents(handles, profiles),
    [handles, profiles]
  );

  const pin = useCallback((behavior: ScrollBehavior) => {
    const scroller = scrollRef.current;
    scroller?.scrollTo({ behavior, top: scroller.scrollHeight });
  }, []);

  // New replies, and markdown or images that finish rendering, grow the list;
  // follow them only while the reader sits at the bottom.
  useEffect(() => {
    const content = contentRef.current;

    if (!content) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        pin("auto");
      }
    });

    observer.observe(content);

    return () => observer.disconnect();
  }, [pin]);

  // Sending a message always brings the reader back down to it; the scroll
  // event then marks the list as at the bottom.
  const lastIsUser = messages.at(-1)?.authorProfileId === null;
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    if (lastIsUser && lastId !== undefined) {
      stickRef.current = true;
      pin("auto");
    }
  }, [lastId, lastIsUser, pin]);

  const stickiness = useMemo(
    () => ({
      isAtBottom,
      scrollToLatest: () => {
        stickRef.current = true;
        setIsAtBottom(true);
        pin("smooth");
      },
    }),
    [isAtBottom, pin]
  );

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );

  const replyingThreads = useMemo(() => new Set(threadRunIds), [threadRunIds]);
  const speaker = profileById.get(run?.speakerProfileId ?? "");
  const keys = messageKeys(messages);

  // A new group starts at a time gap or when the author changes; agents show
  // their avatar and name once per group.
  const rows = useMemo(
    () =>
      messages.map((message, index) => {
        const previous = messages[index - 1];

        const showTime =
          !previous ||
          Date.parse(message.createdAt) - Date.parse(previous.createdAt) >
            TIME_GAP_MS;

        const next = messages[index + 1];

        const nextShowTime =
          next !== undefined &&
          Date.parse(next.createdAt) - Date.parse(message.createdAt) >
            TIME_GAP_MS;

        return {
          endsGroup:
            !next ||
            nextShowTime ||
            next.authorProfileId !== message.authorProfileId,
          message,
          showTime,
          startsGroup:
            showTime || previous?.authorProfileId !== message.authorProfileId,
        };
      }),
    [messages]
  );

  // iMessage marks only the newest message as delivered, and only while it is
  // still the last word.
  const deliveredId =
    messages.at(-1)?.authorProfileId === null && (messages.at(-1)?.id ?? 0) > 0
      ? messages.at(-1)?.id
      : undefined;

  const speakerContinues =
    speaker !== undefined && messages.at(-1)?.authorProfileId === speaker.id;

  return (
    <ConversationStickinessProvider value={stickiness}>
      <Conversation className="min-h-0 flex-1">
        <div
          className="no-scrollbar h-full overflow-y-auto"
          id="agent-group-messages"
          onScroll={(event) => {
            const scroller = event.currentTarget;

            const atBottom =
              scroller.scrollHeight -
                scroller.scrollTop -
                scroller.clientHeight <=
              AT_BOTTOM_PX;

            stickRef.current = atBottom;
            setIsAtBottom(atBottom);
          }}
          ref={scrollRef}
        >
          <div
            className="flex flex-col py-4 max-sm:px-0 sm:px-4"
            ref={contentRef}
          >
            {rows.map(
              ({ endsGroup, message, showTime, startsGroup }, index) => {
                const spacing =
                  index === 0 ? "" : startsGroup ? "mt-3" : "mt-0.5";

                const author = profileById.get(message.authorProfileId ?? "");

                return (
                  <Fragment key={keys[index]}>
                    {showTime ? (
                      <div
                        className={cn(
                          "text-center text-muted-foreground text-xs",
                          index === 0 ? "pb-3" : "py-4"
                        )}
                      >
                        {timeLabel(message.createdAt)}
                      </div>
                    ) : null}
                    {message.authorProfileId === null ? (
                      <div className={cn("flex flex-col items-end", spacing)}>
                        {message.images?.map((path) => (
                          <div className="mb-1 max-w-[75%]" key={path}>
                            <GroupMessageImage path={path} />
                          </div>
                        ))}
                        {message.files || message.content ? (
                          <div
                            className={cn(
                              "[&_span]:!text-white w-fit max-w-[75%] whitespace-pre-wrap rounded-[1.25rem] bg-[#0b84fe] px-3.5 py-2 text-white",
                              endsGroup && "rounded-br-md"
                            )}
                          >
                            {message.files?.map((filename) => (
                              <div
                                className="flex items-center gap-1.5 font-medium text-sm"
                                key={filename}
                              >
                                <File01Icon
                                  aria-hidden
                                  className="size-4 shrink-0"
                                />
                                <span className="truncate">{filename}</span>
                              </div>
                            ))}
                            {message.content ? (
                              <MentionText
                                handles={handles}
                                profiles={profiles}
                                text={message.content}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {message.id === deliveredId && !run ? (
                          <span className="mt-0.5 pr-1 text-muted-foreground text-xs">
                            Delivered
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        className={cn("group flex items-end gap-2", spacing)}
                      >
                        {endsGroup && author ? (
                          <ProfileAvatar
                            className="outline-none"
                            profile={author}
                            size="sm"
                            squareMoodstone
                          />
                        ) : (
                          <span className="size-7 shrink-0" />
                        )}
                        <div className="flex min-w-0 max-w-[75%] flex-col items-start gap-1">
                          {startsGroup ? (
                            <div className="px-3.5 text-muted-foreground text-xs">
                              {author?.name ?? "Unavailable agent"}
                            </div>
                          ) : null}
                          <div
                            className={cn(
                              "relative max-w-full rounded-[1.25rem] bg-muted px-3.5 py-2",
                              endsGroup && "rounded-bl-md"
                            )}
                          >
                            <Message
                              className="mr-0 ml-0 max-w-full items-start justify-start"
                              from="assistant"
                            >
                              <MessageContent className="ml-0 w-full max-w-full gap-1 group-[.is-user]:ml-0">
                                <MessageResponse
                                  components={markdownComponents}
                                >
                                  {markMentions(
                                    shortenSharedPaths(message.content),
                                    handles
                                  )}
                                </MessageResponse>
                              </MessageContent>
                            </Message>
                            <MessageActions
                              onReply={() => onOpenThread(message.id)}
                              text={message.content}
                            />
                          </div>
                          {message.authorProfileId ? (
                            <GroupMessageArtifacts
                              content={message.content}
                              messageId={message.id}
                              profileId={message.authorProfileId}
                            />
                          ) : null}
                          <ThreadLink
                            onClick={() => onOpenThread(message.id)}
                            replies={message.threadReplies}
                            replying={replyingThreads.has(message.id)}
                          />
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              }
            )}
            {run ? (
              <TypingRow
                onOpenLive={onOpenLive}
                speaker={speaker}
                speakerContinues={speakerContinues}
                stopping={run.stopping}
              />
            ) : null}
          </div>
        </div>
        <ConversationScrollButton />
      </Conversation>
    </ConversationStickinessProvider>
  );
}
