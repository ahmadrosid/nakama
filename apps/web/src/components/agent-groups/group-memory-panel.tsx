import type { AgentGroup } from "@nakama/core/agent-groups";
import { NakamaApiError } from "@nakama/core/api-error";
import { Button, Textarea } from "@nakama/ui";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { THREAD_PANEL_WIDTH } from "@/components/agent-groups/group-thread-panel";
import { AttachmentDetailPanel } from "@/components/chat/attachment-detail-panel";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

/** The group's memory: every agent reads it each turn, the user edits it here. */
export function GroupMemoryPanel({
  group,
  onClose,
}: {
  group: AgentGroup;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(THREAD_PANEL_WIDTH);

  return (
    <AttachmentDetailPanel
      bodyClassName="flex flex-col overflow-hidden p-0"
      className="max-sm:absolute max-sm:inset-0 max-sm:z-30"
      headerClassName="px-3 py-1.5"
      onClose={onClose}
      onWidthChange={setWidth}
      title="Memory"
      width={width}
    >
      <GroupMemoryEditor groupId={group.id} />
    </AttachmentDetailPanel>
  );
}

function GroupMemoryEditor({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.agentGroups.memory(groupId);

  const { data, error, isLoading } = useQuery({
    queryFn: () => client.getAgentGroupMemory(groupId),
    queryKey,
  });

  // Null until the user types, so a fact an agent saves meanwhile still shows.
  // `base` is the memory the edit started from, so a refetch cannot move it.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(
    null
  );

  const [saving, setSaving] = useState(false);

  async function save(draftToSave: { base: string; text: string }) {
    setSaving(true);

    try {
      queryClient.setQueryData(
        queryKey,
        await client.updateAgentGroupMemory(
          groupId,
          draftToSave.text,
          draftToSave.base
        )
      );
      setDraft(null);
    } catch (saveError) {
      const changed =
        saveError instanceof NakamaApiError && saveError.status === 409;

      toast(
        changed
          ? "An agent changed the memory while you edited it. It is reloaded, so make your edit again."
          : formatError(saveError)
      );

      if (changed) {
        setDraft(null);
        await queryClient.invalidateQueries({ queryKey });
      }
    } finally {
      setSaving(false);
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
      <p className="p-4 text-muted-foreground text-sm">
        {error ? formatError(error) : "Memory not found"}
      </p>
    );
  }

  const content = draft?.text ?? data.content;
  const over = content.length > data.limit;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" id="group-memory">
      <Textarea
        aria-label="Group memory"
        className="min-h-40 flex-1 resize-none font-mono text-sm"
        id="group-memory-input"
        onChange={(event) =>
          setDraft({
            base: draft?.base ?? data.content,
            text: event.target.value,
          })
        }
        placeholder="- The genre is noir"
        value={content}
      />
      <div className="flex items-center gap-3">
        <span
          className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}
        >
          {over
            ? `Agents see only the first ${data.limit} characters`
            : `${content.length} / ${data.limit}`}
        </span>
        <Button
          className="ml-auto"
          disabled={saving || draft === null || draft.text === draft.base}
          id="btn-save-group-memory"
          onClick={() => draft && save(draft)}
          size="sm"
          type="button"
        >
          Save
        </Button>
      </div>
    </div>
  );
}
