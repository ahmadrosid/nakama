import type { ProfileSummary } from "@nakama/core";
import type {
  AgentGroupMessage,
  AgentGroupRun,
} from "@nakama/core/agent-groups";
import { CheckmarkCircle01Icon, Copy01Icon } from "hugeicons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MentionText,
  markMentions,
  mentionMarkdownComponents,
} from "@/components/agent-groups/group-mentions";
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
import { ThinkingState } from "@/components/chat/ThinkingState";
import { ProfileAvatar } from "@/components/ProfileAvatar";

/** Same threshold as the agent chat list. */
const AT_BOTTOM_PX = 80;

function AgentName({ profile }: { profile?: ProfileSummary }) {
  return (
    <div className="flex items-center gap-2 font-medium text-13 text-foreground">
      {profile ? (
        <ProfileAvatar profile={profile} size="xs" />
      ) : (
        <span className="size-5 shrink-0 rounded-full bg-muted" />
      )}
      {profile?.name ?? "Unavailable agent"}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-1 pt-1 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-active:opacity-100">
      <button
        aria-label={copied ? "Copied" : "Copy response"}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        title={copied ? "Copied" : "Copy response"}
        type="button"
      >
        {copied ? (
          <CheckmarkCircle01Icon aria-hidden className="size-4" />
        ) : (
          <Copy01Icon aria-hidden className="size-4" />
        )}
      </button>
    </div>
  );
}

/** The group transcript, laid out and pinned to the bottom like agent chat. */
export function GroupMessageList({
  handles,
  messages,
  profiles,
  run,
}: {
  handles: Map<string, string>;
  messages: AgentGroupMessage[];
  profiles: ProfileSummary[];
  run: AgentGroupRun | null;
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

  // Sending a message always brings the reader back down to it.
  const lastIsUser = messages.at(-1)?.authorProfileId === null;
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    if (lastIsUser && lastId !== undefined) {
      stickRef.current = true;
      setIsAtBottom(true);
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

  const speaker = profiles.find((p) => p.id === run?.speakerProfileId);

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
          <div className="flex flex-col gap-6 px-4 py-4" ref={contentRef}>
            {messages.map((message) => {
              if (message.authorProfileId === null) {
                return (
                  <Message
                    className="mr-0 ml-auto min-w-0 max-w-full items-end justify-end overflow-visible"
                    from="user"
                    key={message.id}
                  >
                    <MessageContent className="ml-auto min-w-0 max-w-full overflow-visible group-[.is-user]:ml-auto">
                      <p className="whitespace-pre-wrap">
                        <MentionText
                          handles={handles}
                          profiles={profiles}
                          text={message.content}
                        />
                      </p>
                    </MessageContent>
                  </Message>
                );
              }

              return (
                <div
                  className="group mr-auto ml-0 flex w-full max-w-full flex-col items-start justify-start gap-2"
                  key={message.id}
                >
                  <AgentName
                    profile={profiles.find(
                      (p) => p.id === message.authorProfileId
                    )}
                  />
                  <Message
                    className="mr-0 ml-0 max-w-full items-start justify-start"
                    from="assistant"
                  >
                    <MessageContent className="ml-0 w-full max-w-full gap-1 group-[.is-user]:ml-0">
                      <MessageResponse components={markdownComponents}>
                        {markMentions(message.content, handles)}
                      </MessageResponse>
                    </MessageContent>
                  </Message>
                  <CopyButton text={message.content} />
                </div>
              );
            })}
            {run ? (
              <div className="flex flex-col items-start gap-2">
                {speaker ? <AgentName profile={speaker} /> : null}
                <ThinkingState
                  className="text-sm"
                  label={
                    run.stopping
                      ? "Stopping after this reply"
                      : run.activity || "Working…"
                  }
                />
              </div>
            ) : null}
          </div>
        </div>
        <ConversationScrollButton />
      </Conversation>
    </ConversationStickinessProvider>
  );
}
