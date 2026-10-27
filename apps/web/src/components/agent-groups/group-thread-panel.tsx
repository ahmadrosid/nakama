import type { ProfileSummary } from "@nakama/core";
import type { AgentGroup } from "@nakama/core/agent-groups";
import type { WorkspaceEntry } from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GroupComposer } from "@/components/agent-groups/group-composer";
import { GroupMessageArtifacts } from "@/components/agent-groups/group-message-files";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { ThinkingState } from "@/components/chat/ThinkingState";
import { GroupFileViewer } from "@/components/chat/workspace-file-preview";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  type ArtifactTypeFilter,
  artifactMatchesTypeFilter,
  availableArtifactTypeFilters,
} from "@/components/soul-tools/artifacts-tab-filters";
import { useGroupConversation } from "@/hooks/use-agent-groups";
import { shortenSharedPaths } from "@/lib/agent-group-panels";
import { inferArtifactMimeType } from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import {
  type FilesViewMode,
  getStoredFilesViewMode,
  setStoredFilesViewMode,
} from "@/lib/files-page.shared";
import { queryKeys } from "@/lib/query-keys";
import { ArtifactFolderBreadcrumb } from "@/pages/files/files-artifact-folder-breadcrumb";
import { artifactBasename } from "@/pages/files/files-artifact-folders";
import {
  CompactFileEntry,
  FileEntriesLayout,
  FileEntry,
} from "@/pages/files/files-artifact-list-view";
import { FilesSearchRow } from "@/pages/files/files-search-row";
import { FilesToolbar } from "@/pages/files/files-toolbar";

const THREAD_PANEL_WIDTH = 448;

// The side panel's width, shared by its views, so it stays the same when one closes and another opens.
let panelWidth = THREAD_PANEL_WIDTH;

export function useGroupPanelWidth() {
  const [width, setWidth] = useState(panelWidth);

  const changeWidth = useCallback((next: number) => {
    panelWidth = next;
    setWidth(next);
  }, []);

  return [width, changeWidth] as const;
}

// The folder and file the Files panel last showed, per group, for when it opens again.
const filesPanelState = new Map<
  string,
  { folder: string; selected: WorkspaceEntry | null }
>();

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useGroupPanelWidth();

  const { data, error, send, stop } = useGroupConversation(
    group.id,
    sessionId,
    messageId
  );

  const agent = profiles.find((p) => p.id === data?.profileId);
  // The agent's own message is already in the group chat; show only the replies.
  const replies = data?.messages.slice(1) ?? [];
  const noHandles = useMemo(() => new Map<string, string>(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [replies.length, data?.run]);

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
                <MessageResponse>
                  {shortenSharedPaths(message.content)}
                </MessageResponse>
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
          allowDocuments
          busy={data?.run != null}
          handles={noHandles}
          members={agent ? [agent] : []}
          onSend={send}
          onStop={stop}
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
  const [width, setWidth] = useGroupPanelWidth();
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

/** The group's shared folder, which its agents write to; `file` opens on that file. */
export function GroupFilesPanel({
  file,
  group,
  onClose,
}: {
  file: string | null;
  group: AgentGroup;
  onClose: () => void;
}) {
  const [width, setWidth] = useGroupPanelWidth();

  const [state, setState] = useState(() => {
    const cached = filesPanelState.get(group.id);
    const filename = file?.split("/").pop();

    if (!(file && filename)) {
      return cached ?? { folder: "", selected: null };
    }

    // A file link opens that file; the cached one is kept if it is the same file.
    const selected: WorkspaceEntry =
      cached?.selected?.path === file
        ? cached.selected
        : {
            filename,
            kind: "file",
            mimeType: inferArtifactMimeType(filename),
            path: file,
            sizeBytes: 0,
            updatedAt: "",
          };

    const next = { folder: cached?.folder ?? "", selected };
    filesPanelState.set(group.id, next);

    return next;
  });

  const { folder, selected } = state;

  function update(next: typeof state) {
    filesPanelState.set(group.id, next);
    setState(next);
  }

  const setFolder = (next: string) => update({ ...state, folder: next });

  const setSelected = (next: WorkspaceEntry | null) =>
    update({ ...state, selected: next });

  return (
    <AttachmentDetailPanel
      bodyClassName="flex flex-col overflow-hidden p-0"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30"
      headerClassName="px-3 py-1.5"
      onClose={onClose}
      onWidthChange={setWidth}
      title="Files"
      width={width}
    >
      {selected ? (
        <GroupFileViewer
          entry={selected}
          groupId={group.id}
          key={selected.path}
          onBack={() => setSelected(null)}
        />
      ) : (
        <GroupFilesList
          folder={folder}
          groupId={group.id}
          onFolder={setFolder}
          onSelect={setSelected}
        />
      )}
    </AttachmentDetailPanel>
  );
}

/** One folder of the group's shared files, with the Browse Files toolbar. */
function GroupFilesList({
  folder,
  groupId,
  onFolder,
  onSelect,
}: {
  folder: string;
  groupId: string;
  onFolder: (folder: string) => void;
  onSelect: (entry: WorkspaceEntry) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>("all");

  const [viewMode, setViewMode] = useState<FilesViewMode>(
    getStoredFilesViewMode
  );

  const { data, error, isFetching, isLoading, refetch } = useQuery({
    queryFn: () => client.listAgentGroupFiles(groupId, folder),
    queryKey: queryKeys.agentGroups.files(groupId, folder),
    // Agents add files while they reply.
    refetchInterval: 4000,
  });

  const typeOptions = availableArtifactTypeFilters(
    (data?.entries ?? []).filter((entry) => entry.kind !== "directory")
  );

  const entries = (data?.entries ?? []).filter(
    (entry) =>
      artifactBasename(entry.filename)
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (entry.kind === "directory" ||
        artifactMatchesTypeFilter(entry, typeFilter))
  );

  function openFolder(next: string) {
    setSearch("");
    onFolder(next);
  }

  return (
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <FilesToolbar
        isFetching={isFetching}
        onRefresh={() => void refetch()}
        onViewModeChange={(mode) => {
          setViewMode(mode);
          setStoredFilesViewMode(mode);
        }}
        showViewModeToggle
        viewMode={viewMode}
      >
        <FilesSearchRow
          onSearchQueryChange={setSearch}
          onTypeFilterChange={setTypeFilter}
          searchLabel="Search current folder"
          searchQuery={search}
          typeFilter={typeFilter}
          typeOptions={typeOptions}
        />
      </FilesToolbar>
      <ArtifactFolderBreadcrumb onNavigate={openFolder} prefix={folder} />
      {error ? (
        <p className="text-destructive text-sm">{formatError(error)}</p>
      ) : isLoading ? null : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {search ? "No matching files." : "No files yet."}
        </p>
      ) : (
        <FileEntriesLayout compact viewMode={viewMode}>
          {entries.map((entry) => {
            const directory = entry.kind === "directory";

            const open = () =>
              directory ? openFolder(entry.path) : onSelect(entry);

            const filename = artifactBasename(entry.filename);

            return viewMode === "list" ? (
              <CompactFileEntry
                {...entry}
                directory={directory}
                filename={filename}
                key={entry.path}
                onOpen={open}
              />
            ) : (
              <FileEntry
                {...entry}
                directory={directory}
                filename={filename}
                key={entry.path}
                onOpen={open}
                viewMode={viewMode}
              />
            );
          })}
        </FileEntriesLayout>
      )}
    </div>
  );
}
