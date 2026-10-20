import type { ProfileSummary } from "@nakama/core";
import {
  type AgentGroup,
  type AgentGroupMessage,
  type AgentGroupRun,
  type AgentGroupSession,
  type AgentGroupSessionDetail,
  memberHandles,
} from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { Button } from "@nakama/ui";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainIcon,
  Folder01Icon,
  MessageAdd01Icon,
  PencilEdit02Icon,
} from "hugeicons-react";
import { useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { GroupComposer } from "@/components/agent-groups/group-composer";
import { GroupDialog } from "@/components/agent-groups/group-dialog";
import { GroupMemoryPanel } from "@/components/agent-groups/group-memory-panel";
import { GroupMessageList } from "@/components/agent-groups/group-message-list";
import {
  GroupFilesPanel,
  GroupLivePanel,
  GroupThreadPanel,
} from "@/components/agent-groups/group-thread-panel";
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
  "sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:pt-4 sm:pb-4";

const NO_THREAD_RUNS: number[] = [];

/** Search params of the side panel; one is open at a time. */
const PANELS = ["files", "live", "memory", "thread"] as const;

/** `/groups/:groupId` is a new chat in the group; with `:sessionId` one of its chats. */
export function AgentGroupChatPage() {
  const { groupId = "", sessionId } = useParams();
  const { data: group, error, isLoading } = useAgentGroupQuery(groupId);
  const { data: profiles = [] } = useProfilesQuery();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = Number(searchParams.get("thread"));
  const openThreadId = sessionId && requested > 0 ? requested : null;
  const liveOpen = Boolean(sessionId) && searchParams.get("live") === "1";
  const filesOpen = searchParams.get("files") === "1";
  const memoryOpen = searchParams.get("memory") === "1";

  // The thread, the live view, the files and the memory share one side panel; opening one closes the others.
  function setPanel(panel: (typeof PANELS)[number], value: string | null) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);

        for (const key of PANELS) {
          next.delete(key);
        }

        if (value !== null) {
          next.set(panel, value);
        }

        return next;
      },
      { replace: true }
    );
  }

  const setThread = (messageId: number | null) =>
    setPanel("thread", messageId === null ? null : String(messageId));

  const setLive = (open: boolean) => setPanel("live", open ? "1" : null);
  const setFilesOpen = (open: boolean) => setPanel("files", open ? "1" : null);
  const closeMemory = () => setPanel("memory", null);

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
    // The thread opens in its `below` slot: the same framed side panel as /btw.
    <ChatAttachmentPanelProvider
      below={
        <GroupSidePanel
          filesOpen={filesOpen}
          group={group}
          liveOpen={liveOpen}
          memoryOpen={memoryOpen}
          onCloseFiles={() => setFilesOpen(false)}
          onCloseLive={() => setLive(false)}
          onCloseMemory={closeMemory}
          onCloseThread={() => setThread(null)}
          profiles={profiles}
          sessionId={sessionId}
          threadId={openThreadId}
        />
      }
      key={`${groupId}:${sessionId ?? "new"}`}
    >
      {sessionId ? (
        <GroupSession
          group={group}
          onOpenLive={() => setLive(true)}
          onOpenThread={setThread}
          profiles={profiles}
          sessionId={sessionId}
        />
      ) : (
        <GroupDraft group={group} profiles={profiles} />
      )}
    </ChatAttachmentPanelProvider>
  );
}

/** The one side panel that is open: files, memory, the live view, or a thread. */
function GroupSidePanel({
  filesOpen,
  group,
  liveOpen,
  memoryOpen,
  onCloseFiles,
  onCloseLive,
  onCloseMemory,
  onCloseThread,
  profiles,
  sessionId,
  threadId,
}: {
  filesOpen: boolean;
  group: AgentGroup;
  liveOpen: boolean;
  memoryOpen: boolean;
  onCloseFiles: () => void;
  onCloseLive: () => void;
  onCloseMemory: () => void;
  onCloseThread: () => void;
  profiles: ProfileSummary[];
  sessionId?: string;
  threadId: number | null;
}) {
  if (filesOpen) {
    return (
      <GroupFilesPanel group={group} key={group.id} onClose={onCloseFiles} />
    );
  }

  if (memoryOpen) {
    return (
      <GroupMemoryPanel group={group} key={group.id} onClose={onCloseMemory} />
    );
  }

  if (sessionId && liveOpen) {
    return (
      <GroupLivePanel
        group={group}
        onClose={onCloseLive}
        profiles={profiles}
        sessionId={sessionId}
      />
    );
  }

  if (sessionId && threadId) {
    return (
      <GroupThreadPanel
        group={group}
        key={threadId}
        messageId={threadId}
        onClose={onCloseThread}
        profiles={profiles}
        sessionId={sessionId}
      />
    );
  }

  return null;
}

function joinNames(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
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

/** Opens the group's shared folder or memory in the side panel. */
function GroupPanelButton({
  icon: Icon,
  label,
  panel,
}: {
  icon: typeof Folder01Icon;
  label: string;
  panel: "files" | "memory";
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Button
      aria-label={label}
      onClick={() =>
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);

            for (const key of PANELS) {
              next.delete(key);
            }

            next.set(panel, "1");

            return next;
          },
          { replace: true }
        )
      }
      size="sm"
      type="button"
      variant={searchParams.get(panel) === "1" ? "secondary" : "outline"}
    >
      <Icon aria-hidden />
      {/* Icon only while the side panel leaves the header narrow. */}
      <span className="@2xl:inline hidden">{label}</span>
    </Button>
  );
}

function GroupPanelButtons() {
  return (
    <>
      <GroupPanelButton icon={Folder01Icon} label="Files" panel="files" />
      <GroupPanelButton icon={BrainIcon} label="Memory" panel="memory" />
    </>
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

/** The group's name, its agents' avatars and count, and the edit group and new chat buttons. */
function GroupHeader({
  group,
  members,
}: {
  group: AgentGroup;
  members: ProfileSummary[];
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  return (
    <header className="@container flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
      <h1 className="truncate font-semibold text-lg tracking-tight">
        {group.name}
      </h1>
      <div className="flex shrink-0 -space-x-2">
        {members.slice(0, 4).map((member) => (
          <ProfileAvatar
            className="outline-none"
            key={member.id}
            profile={member}
            size="sm"
          />
        ))}
      </div>
      <span className="shrink-0 text-muted-foreground text-sm">
        {group.memberIds.length} agents
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          onClick={() => setEditing(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <PencilEdit02Icon aria-hidden />
          Edit group
        </Button>
        <GroupPanelButtons />
        <Button
          onClick={() => navigate(groupPath(group.id))}
          size="sm"
          type="button"
        >
          <MessageAdd01Icon aria-hidden />
          New chat
        </Button>
      </div>
      {editing ? (
        <GroupDialog group={group} onClose={() => setEditing(false)} />
      ) : null}
    </header>
  );
}

/** The transcript with the composer docked under it, as in agent chat. */
function GroupConversation({
  group,
  messages,
  onOpenLive,
  onOpenThread,
  onSend,
  onStop,
  profiles,
  run,
  threadRunIds = NO_THREAD_RUNS,
}: {
  group: AgentGroup;
  messages: AgentGroupMessage[];
  /** Absent while a new chat's session is still being created. */
  onOpenLive?: () => void;
  onOpenThread?: (messageId: number) => void;
  onSend: (content: string, documents?: DocumentAttachment[]) => Promise<void>;
  onStop: () => void;
  profiles: ProfileSummary[];
  run: AgentGroupRun | null;
  threadRunIds?: number[];
}) {
  const { handles, members } = useMembers(group, profiles);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GroupHeader group={group} members={members} />
      <ChatPageColumn>
        <div
          className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"
          id="agent-group-chat"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <GroupMessageList
              handles={handles}
              messages={messages}
              onOpenLive={() => onOpenLive?.()}
              onOpenThread={(messageId) => onOpenThread?.(messageId)}
              profiles={profiles}
              run={run}
              threadRunIds={threadRunIds}
            />
          </div>
          <div className={COMPOSER_DOCK}>
            <GroupComposer
              allowDocuments
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
    </div>
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
  const [editing, setEditing] = useState(false);
  const creating = useRef<Promise<AgentGroupSession> | null>(null);

  // `handles` maps handle to member id.
  const handleOf = (id: string) =>
    [...handles].find(([, memberId]) => memberId === id)?.[0] ?? "";

  async function sendFirst(
    content: string,
    documents: DocumentAttachment[] = []
  ) {
    const message = pendingMessage(
      content,
      documents.map((document) => document.filename)
    );

    const request = client.createAgentGroupSession(
      group.id,
      content,
      documents
    );

    creating.current = request;
    setPending(message);

    try {
      const session = await request;

      queryClient.setQueryData<AgentGroupSessionDetail>(
        queryKeys.agentGroups.session(group.id, session.id),
        {
          group,
          messages: [message],
          run: PENDING_RUN,
          session,
          threadRunIds: [],
        }
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
        onSend={async (content, documents) => {
          const session = await creating.current;

          if (session) {
            await client.sendAgentGroupMessage(
              group.id,
              session.id,
              content,
              documents
            );
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
        <div className="@container flex shrink-0 justify-end gap-2 px-4 pt-4">
          <Button
            onClick={() => setEditing(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <PencilEdit02Icon aria-hidden />
            Edit group
          </Button>
          <GroupPanelButtons />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-6 pb-12">
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            {group.avatarVersion ? (
              <GroupAvatar
                className="size-16 rounded-2xl"
                group={group}
                profiles={profiles}
              />
            ) : (
              <div className="flex -space-x-2">
                {members.slice(0, 2).map((member) => (
                  <ProfileAvatar
                    className="size-16 outline-none"
                    key={member.id}
                    profile={member}
                    size="lg"
                  />
                ))}
              </div>
            )}
            <h2 className="type-section-title text-2xl tracking-tight">
              {group.name}
            </h2>
            <p className="text-muted-foreground text-sm">
              {joinNames(members.map((member) => member.name))}
            </p>
          </div>
          <GroupComposer
            allowDocuments
            busy={false}
            handles={handles}
            initialInput={restored}
            key={restored}
            members={members}
            onSend={sendFirst}
            onStop={() => undefined}
            stopping={false}
          />
          <div className="flex flex-wrap justify-center gap-2 px-4">
            <button
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={() => void sendFirst("@all introduce yourselves")}
              type="button"
            >
              <span className="text-primary">@all</span>
              introduce yourselves
            </button>
            {members.slice(0, 2).map((member) => (
              <button
                className="inline-flex items-center gap-2 rounded-full border border-border py-1.5 pr-3 pl-1.5 text-sm hover:bg-muted"
                key={member.id}
                onClick={() =>
                  void sendFirst(
                    `@${handleOf(member.id)} what can you help with?`
                  )
                }
                type="button"
              >
                <ProfileAvatar
                  className="outline-none"
                  profile={member}
                  size="xs"
                />
                {member.name}: what can you help with?
              </button>
            ))}
          </div>
        </div>
        {editing ? (
          <GroupDialog group={group} onClose={() => setEditing(false)} />
        ) : null}
      </div>
    </ChatPageColumn>
  );
}

function GroupSession({
  group,
  onOpenLive,
  onOpenThread,
  profiles,
  sessionId,
}: {
  group: AgentGroup;
  onOpenLive: () => void;
  onOpenThread: (messageId: number) => void;
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
      !sending &&
      (query.state.data?.run || query.state.data?.threadRunIds?.length)
        ? 1500
        : false,
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
  async function send(content: string, documents: DocumentAttachment[] = []) {
    setSending(true);
    await queryClient.cancelQueries({ exact: true, queryKey: sessionKey });
    queryClient.setQueryData<AgentGroupSessionDetail>(sessionKey, (detail) =>
      detail
        ? withPendingMessage(
            detail,
            content,
            documents.map((document) => document.filename)
          )
        : detail
    );

    try {
      await client.sendAgentGroupMessage(
        group.id,
        sessionId,
        content,
        documents
      );
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
      onOpenLive={onOpenLive}
      onOpenThread={onOpenThread}
      onSend={send}
      onStop={() =>
        void client
          .stopAgentGroupSession(group.id, sessionId)
          .then(refresh)
          .catch((stopError) => toast(formatError(stopError)))
      }
      profiles={profiles}
      run={data.run}
      threadRunIds={data.threadRunIds}
    />
  );
}
