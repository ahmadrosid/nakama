import type { ProfileSummary } from "@nakama/core";
import {
  type AgentGroup,
  type AgentGroupMessage,
  type AgentGroupRun,
  type AgentGroupSession,
  type AgentGroupSessionDetail,
  groupRoster,
} from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { Button } from "@nakama/ui";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { MessageAdd01Icon } from "hugeicons-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { GroupActionsMenu } from "@/components/agent-groups/group-actions-menu";
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
import {
  PENDING_RUN,
  pendingMessage,
  useAgentGroupQuery,
  useGroupConversation,
} from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { type PANELS, withPanel } from "@/lib/agent-group-panels";
import { client, formatError } from "@/lib/client";
import { groupPath, PAGE_PATHS } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";
import { ChatPageColumn } from "@/pages/chat/chat-page-layout";

const COMPOSER_DOCK =
  "sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:pt-4 sm:pb-4";

const NO_THREAD_RUNS: number[] = [];

/** `/groups/:groupId` is a new chat in the group; with `:sessionId` one of its chats. */
export function AgentGroupChatPage() {
  const { groupId = "", sessionId } = useParams();
  const { data: group, error, isLoading } = useAgentGroupQuery(groupId);
  const { data: profiles = [] } = useProfilesQuery();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = Number(searchParams.get("thread"));
  const openThreadId = sessionId && requested > 0 ? requested : null;
  const liveOpen = Boolean(sessionId) && searchParams.get("live") === "1";
  const files = searchParams.get("files");
  const filesOpen = files !== null;
  const memoryOpen = searchParams.get("memory") === "1";

  // The thread, the live view, the files and the memory share one side panel; opening one closes the others.
  function setPanel(panel: (typeof PANELS)[number], value: string | null) {
    setSearchParams((current) => withPanel(current, panel, value), {
      replace: true,
    });
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
        // An empty slot would still frame a blank column beside the chat.
        filesOpen || memoryOpen || (sessionId && (liveOpen || openThreadId)) ? (
          <GroupSidePanel
            file={files === "1" ? null : files}
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
        ) : null
      }
      key={`${groupId}:${sessionId ?? "new"}`}
      rememberId={sessionId}
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
  file,
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
  file: string | null;
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
      <GroupFilesPanel
        file={file}
        group={group}
        key={`${group.id}:${file ?? ""}`}
        onClose={onCloseFiles}
      />
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

/**
 * Top bar of an open group chat: the group's name, its agents, and the new
 * chat and group actions. Same height and rule as the side panel header, so
 * the two line up, as on the agent chat page.
 */
function GroupHeader({
  group,
  members,
}: {
  group: AgentGroup;
  members: ProfileSummary[];
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const actions = (
    <>
      <Button
        onClick={() => navigate(groupPath(group.id))}
        size="sm"
        type="button"
        variant="ghost"
      >
        <MessageAdd01Icon aria-hidden />
        <span className="max-sm:sr-only">New chat</span>
      </Button>
      <GroupActionsMenu onEdit={() => setEditing(true)} />
    </>
  );

  // On a phone the app navbar names the group, so the actions move up there.
  const navbarActions = document.querySelector("[data-page-header-actions]");

  return (
    <>
      <header className="-mx-6 flex shrink-0 items-center gap-2 border-border border-b px-4 py-3 max-sm:hidden">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2.5">
          <h1 className="truncate font-medium text-sm">{group.name}</h1>
          <div className="flex shrink-0 -space-x-1.5">
            {members.slice(0, 4).map((member) => (
              <ProfileAvatar
                className="outline-none"
                key={member.id}
                profile={member}
                size="xs"
              />
            ))}
          </div>
          <span className="shrink-0 text-muted-foreground text-xs">
            {group.memberIds.length} agents
          </span>
        </div>
        <div className="flex h-7 shrink-0 items-center gap-1">{actions}</div>
      </header>
      {navbarActions
        ? createPortal(
            <div className="flex items-center gap-2 sm:hidden">{actions}</div>,
            navbarActions
          )
        : null}
      {editing ? (
        <GroupDialog group={group} onClose={() => setEditing(false)} />
      ) : null}
    </>
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
  const roster = useMemo(() => groupRoster(group, profiles), [group, profiles]);
  const { members } = roster;

  return (
    <ChatPageColumn>
      <GroupHeader group={group} members={members} />
      <div
        className="mx-auto flex min-h-0 w-full flex-1 flex-col"
        id="agent-group-chat"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <GroupMessageList
            messages={messages}
            onOpenLive={() => onOpenLive?.()}
            onOpenThread={(messageId) => onOpenThread?.(messageId)}
            profiles={profiles}
            roster={roster}
            run={run}
            threadRunIds={threadRunIds}
          />
        </div>
        <div className={COMPOSER_DOCK}>
          <div className="mx-auto w-full max-w-3xl sm:px-4">
            <GroupComposer
              allowDocuments
              busy={run !== null}
              onSend={onSend}
              onStop={onStop}
              roster={roster}
              stopping={run?.stopping ?? false}
            />
          </div>
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
  const roster = useMemo(() => groupRoster(group, profiles), [group, profiles]);
  const { members } = roster;
  const [pending, setPending] = useState<AgentGroupMessage | null>(null);
  const [restored, setRestored] = useState("");
  const [editing, setEditing] = useState(false);
  const creating = useRef<Promise<AgentGroupSession> | null>(null);

  async function sendFirst(
    content: string,
    documents: DocumentAttachment[] = []
  ) {
    const message = pendingMessage(content, documents);

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
    <ChatPageColumn centered>
      {/* Pinned to the column's top-right corner, like the cognito toggle in agent chat. */}
      <div className="absolute top-2 right-3 z-20 sm:right-6">
        <GroupActionsMenu onEdit={() => setEditing(true)} />
      </div>
      <div
        className="mx-auto mb-12 flex w-full max-w-3xl flex-col"
        id="group-new-chat"
      >
        <div className="flex flex-col gap-6">
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
            initialInput={restored}
            key={restored}
            onSend={sendFirst}
            onStop={() => undefined}
            roster={roster}
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
                    `@${roster.handleOf(member.id)} what can you help with?`
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
  const { data, error, isLoading, send, stop } = useGroupConversation(
    group.id,
    sessionId
  );

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
      onStop={stop}
      profiles={profiles}
      run={data.run}
      threadRunIds={data.threadRunIds}
    />
  );
}
