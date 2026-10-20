import type { ProfileSummary } from "@nakama/core";
import type {
  AgentGroup,
  AgentGroupThreadDetail,
} from "@nakama/core/agent-groups";
import { toast } from "@nakama/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { GroupComposer } from "@/components/agent-groups/group-composer";
import { GroupMessageArtifacts } from "@/components/agent-groups/group-message-list";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { ThinkingState } from "@/components/chat/ThinkingState";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { PENDING_RUN, pendingMessage } from "@/lib/agent-group-pending";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const THREAD_PANEL_WIDTH = 448;

/** A private chat with the agent that wrote one message of the group chat. */
export function GroupThreadPanel({
  group,
  messageId,
  onClose,
  profiles,
  sessionId,
}: {
  group: AgentGroup;
  messageId: number;
  onClose: () => void;
  profiles: ProfileSummary[];
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(THREAD_PANEL_WIDTH);

  const threadKey = queryKeys.agentGroups.thread(
    group.id,
    sessionId,
    messageId
  );

  const { data, error } = useQuery({
    queryFn: () => client.getAgentGroupThread(group.id, sessionId, messageId),
    queryKey: threadKey,
    // Poll only while the agent is replying.
    refetchInterval: (query) => (query.state.data?.run ? 1500 : false),
  });

  const agent = profiles.find((p) => p.id === data?.profileId);
  // The agent's own message is already in the group chat; show only the replies.
  const replies = data?.messages.slice(1) ?? [];
  const noHandles = useMemo(() => new Map<string, string>(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [replies.length, data?.run]);

  const refresh = () =>
    // The session key is the thread key's parent: it refreshes the reply count.
    queryClient.invalidateQueries({
      queryKey: queryKeys.agentGroups.session(group.id, sessionId),
    });

  async function send(content: string) {
    await queryClient.cancelQueries({ exact: true, queryKey: threadKey });
    queryClient.setQueryData<AgentGroupThreadDetail>(threadKey, (detail) =>
      detail
        ? {
            ...detail,
            messages: [...detail.messages, pendingMessage(content)],
            run: detail.run ?? PENDING_RUN,
          }
        : detail
    );

    try {
      await client.sendAgentGroupThreadMessage(
        group.id,
        sessionId,
        messageId,
        content
      );
    } catch (sendError) {
      toast(formatError(sendError));
      throw sendError;
    } finally {
      void refresh();
    }
  }

  return (
    <AttachmentDetailPanel
      bodyClassName="flex flex-col overflow-hidden p-0"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30"
      headerClassName="px-3 py-1.5"
      onClose={onClose}
      onWidthChange={setWidth}
      title={`Thread with ${agent?.name ?? "agent"}`}
      width={width}
    >
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {error && !data ? (
          <p className="text-muted-foreground text-sm">{formatError(error)}</p>
        ) : null}
        {replies.map((message) =>
          message.authorProfileId === null ? (
            <Message
              className="mr-0 ml-auto min-w-0 max-w-full items-end justify-end overflow-visible"
              from="user"
              key={`user-${message.id}`}
            >
              <MessageContent className="ml-auto min-w-0 max-w-full overflow-visible group-[.is-user]:ml-auto">
                <p className="whitespace-pre-wrap">{message.content}</p>
              </MessageContent>
            </Message>
          ) : (
            <div className="flex items-start gap-3" key={message.id}>
              {agent ? (
                <ProfileAvatar
                  className="outline-none"
                  profile={agent}
                  size="sm"
                />
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium text-13">{agent?.name}</span>
                <MessageResponse>{message.content}</MessageResponse>
                <GroupMessageArtifacts
                  content={message.content}
                  messageId={message.id}
                  profileId={message.authorProfileId}
                />
              </div>
            </div>
          )
        )}
        {data?.run ? (
          <div className="flex items-start gap-3">
            {agent ? (
              <ProfileAvatar
                className="outline-none"
                profile={agent}
                size="sm"
              />
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="font-medium text-13">{agent?.name}</span>
              <ThinkingState
                className="text-sm"
                label={
                  data.run.stopping
                    ? "Stopping after this reply"
                    : data.run.activity || "Working…"
                }
              />
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <div className="shrink-0 px-4 pt-2 pb-4">
        <GroupComposer
          busy={data?.run != null}
          handles={noHandles}
          members={agent ? [agent] : []}
          onSend={send}
          onStop={() =>
            void client
              .stopAgentGroupThread(group.id, sessionId, messageId)
              .then(() =>
                queryClient.invalidateQueries({
                  exact: true,
                  queryKey: threadKey,
                })
              )
              .catch((stopError) => toast(formatError(stopError)))
          }
          placeholder={`Reply to ${agent?.name ?? "agent"}`}
          stopping={data?.run?.stopping ?? false}
        />
      </div>
    </AttachmentDetailPanel>
  );
}

/** The working agent's steps and answer as it writes them. */
export function GroupLivePanel({
  group,
  onClose,
  profiles,
  sessionId,
}: {
  group: AgentGroup;
  onClose: () => void;
  profiles: ProfileSummary[];
  sessionId: string;
}) {
  const [width, setWidth] = useState(THREAD_PANEL_WIDTH);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryFn: () => client.getAgentGroupSession(group.id, sessionId),
    queryKey: queryKeys.agentGroups.session(group.id, sessionId),
  });

  const run = data?.run ?? null;
  const agent = profiles.find((p) => p.id === run?.speakerProfileId);
  const text = run?.text ?? "";
  const stepCount = run?.steps?.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [text, stepCount]);

  return (
    <AttachmentDetailPanel
      bodyClassName="flex flex-col overflow-hidden p-0"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30"
      headerClassName="px-3 py-1.5"
      onClose={onClose}
      onWidthChange={setWidth}
      title={agent ? `${agent.name} live` : "Live"}
      width={width}
    >
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {run?.steps?.map((step, index) => (
          <p
            className="text-muted-foreground text-sm"
            // Steps repeat and only ever append.
            key={`${index}-${step}`}
          >
            {step}
          </p>
        ))}
        {text ? <MessageResponse>{text}</MessageResponse> : null}
        {run ? (
          <ThinkingState
            className="text-sm"
            label={run.stopping ? "Stopping after this reply" : "Working…"}
          />
        ) : (
          <p className="text-muted-foreground text-sm">Done</p>
        )}
        <div ref={bottomRef} />
      </div>
    </AttachmentDetailPanel>
  );
}
