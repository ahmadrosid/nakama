import type { ProfileSummary } from "@nakama/core";
import {
  type AgentGroup,
  type AgentGroupMessage,
  type AgentGroupRun,
  type AgentGroupSession,
  type AgentGroupSessionDetail,
  memberHandles,
} from "@nakama/core/agent-groups";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { GroupComposer } from "@/components/agent-groups/group-composer";
import { GroupMessageList } from "@/components/agent-groups/group-message-list";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useAgentGroupQuery } from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  PENDING_RUN,
  pendingMessage,
  withPendingMessage,
} from "@/lib/agent-group-pending";
import { client, formatError } from "@/lib/client";
import { groupPath, PAGE_PATHS } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";
import { ChatPageColumn } from "@/pages/chat/chat-page-layout";

const COMPOSER_DOCK =
  "sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:pt-4 sm:pb-4";

/** `/groups/:groupId` is a new chat in the group; with `:sessionId` one of its chats. */
export function AgentGroupChatPage() {
  const { groupId = "", sessionId } = useParams();
  const { data: group, error, isLoading } = useAgentGroupQuery(groupId);
  const { data: profiles = [] } = useProfilesQuery();

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!group) {
    return <GroupMissing message={error ? formatError(error) : undefined} />;
  }

  return (
    // The chat column reads the attachment panel, as on the agent chat page.
    <ChatAttachmentPanelProvider key={`${groupId}:${sessionId ?? "new"}`}>
      {sessionId ? (
        <GroupSession group={group} profiles={profiles} sessionId={sessionId} />
      ) : (
        <GroupDraft group={group} profiles={profiles} />
      )}
    </ChatAttachmentPanelProvider>
  );
}

function GroupMissing({ message }: { message?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
      <p className="text-muted-foreground">{message ?? "Group not found"}</p>
      <Link className="underline" to={PAGE_PATHS.groups}>
        Back to groups
      </Link>
    </div>
  );
}

function useMembers(group: AgentGroup, profiles: ProfileSummary[]) {
  const members = useMemo(
    () =>
      group.memberIds.flatMap(
        (id) => profiles.find((profile) => profile.id === id) ?? []
      ),
    [group.memberIds, profiles]
  );

  return { handles: useMemo(() => memberHandles(members), [members]), members };
}

/** The transcript with the composer docked under it, as in agent chat. */
function GroupConversation({
  group,
  messages,
  onSend,
  onStop,
  profiles,
  run,
}: {
  group: AgentGroup;
  messages: AgentGroupMessage[];
  onSend: (content: string) => Promise<void>;
  onStop: () => void;
  profiles: ProfileSummary[];
  run: AgentGroupRun | null;
}) {
  const { handles, members } = useMembers(group, profiles);

  return (
    <ChatPageColumn>
      <div
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"
        id="agent-group-chat"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <GroupMessageList
            handles={handles}
            messages={messages}
            profiles={profiles}
            run={run}
          />
        </div>
        <div className={COMPOSER_DOCK}>
          <GroupComposer
            busy={run !== null}
            handles={handles}
            members={members}
            onSend={onSend}
            onStop={onStop}
            stopping={run?.stopping ?? false}
          />
        </div>
      </div>
    </ChatPageColumn>
  );
}

/**
 * A new chat: the welcome and composer sit centered, like an agent's new chat.
 * The first message shows at once while its session is created, then the page
 * moves to that session with the message already in place.
 */
function GroupDraft({
  group,
  profiles,
}: {
  group: AgentGroup;
  profiles: ProfileSummary[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { handles, members } = useMembers(group, profiles);
  const [pending, setPending] = useState<AgentGroupMessage | null>(null);
  const [restored, setRestored] = useState("");
  const creating = useRef<Promise<AgentGroupSession> | null>(null);

  async function sendFirst(content: string) {
    const message = pendingMessage(content);
    const request = client.createAgentGroupSession(group.id, content);
    creating.current = request;
    setPending(message);

    try {
      const session = await request;

      queryClient.setQueryData<AgentGroupSessionDetail>(
        queryKeys.agentGroups.session(group.id, session.id),
        { group, messages: [message], run: PENDING_RUN, session }
      );
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.agentGroups.sessions(group.id),
      });
      navigate(groupPath(group.id, session.id), { replace: true });
    } catch (sendError) {
      setPending(null);
      setRestored(content);
      toast(formatError(sendError));
      throw sendError;
    }
  }

  if (pending) {
    return (
      <GroupConversation
        group={group}
        messages={[pending]}
        // A second message before the session exists waits for it.
        onSend={async (content) => {
          const session = await creating.current;

          if (session) {
            await client.sendAgentGroupMessage(group.id, session.id, content);
          }
        }}
        onStop={() => undefined}
        profiles={profiles}
        run={PENDING_RUN}
      />
    );
  }

  return (
    <ChatPageColumn>
      <div
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"
        id="group-new-chat"
      >
        <div className="flex flex-1 flex-col justify-center gap-6 pb-12">
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <GroupAvatar
              className="size-16 rounded-2xl"
              group={group}
              profiles={profiles}
            />
            <h2 className="type-section-title text-xl tracking-tight">
              {group.name}
            </h2>
            <div className="flex flex-wrap justify-center gap-1.5">
              {members.map((member) => (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-13"
                  key={member.id}
                >
                  <ProfileAvatar profile={member} size="xxs" />
                  {member.name}
                </span>
              ))}
            </div>
          </div>
          <GroupComposer
            busy={false}
            handles={handles}
            initialInput={restored}
            key={restored}
            members={members}
            onSend={sendFirst}
            onStop={() => undefined}
            stopping={false}
          />
        </div>
      </div>
    </ChatPageColumn>
  );
}

function GroupSession({
  group,
  profiles,
  sessionId,
}: {
  group: AgentGroup;
  profiles: ProfileSummary[];
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const sessionKey = queryKeys.agentGroups.session(group.id, sessionId);
  // A poll answered before the server saw the message would erase it.
  const [sending, setSending] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryFn: () => client.getAgentGroupSession(group.id, sessionId),
    queryKey: sessionKey,
    // Poll only while agents are replying.
    refetchInterval: (query) =>
      !sending && query.state.data?.run ? 1500 : false,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKey }),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.agentGroups.sessions(group.id),
      }),
    ]).then(() => undefined);

  /** Shows the message at once, then lets the server confirm or roll it back. */
  async function send(content: string) {
    setSending(true);
    await queryClient.cancelQueries({ exact: true, queryKey: sessionKey });
    queryClient.setQueryData<AgentGroupSessionDetail>(sessionKey, (detail) =>
      detail ? withPendingMessage(detail, content) : detail
    );

    try {
      await client.sendAgentGroupMessage(group.id, sessionId, content);
    } catch (sendError) {
      toast(formatError(sendError));
      throw sendError;
    } finally {
      setSending(false);
      void refresh();
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!data) {
    return (
      <GroupMissing message={error ? formatError(error) : "Chat not found"} />
    );
  }

  return (
    <GroupConversation
      group={group}
      messages={data.messages}
      onSend={send}
      onStop={() =>
        void client
          .stopAgentGroupSession(group.id, sessionId)
          .then(refresh)
          .catch((stopError) => toast(formatError(stopError)))
      }
      profiles={profiles}
      run={data.run}
    />
  );
}
