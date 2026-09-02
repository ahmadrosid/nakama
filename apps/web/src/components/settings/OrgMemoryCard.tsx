import { parseOrgMemoryContent } from "@nakama/core/soul/org-memory";
import { PencilIcon, PinIcon } from "hugeicons-react";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OrgMemoryHistoryPanel } from "@/components/settings/OrgMemoryHistoryPanel";
import { OrgMemoryProposalsPanel } from "@/components/settings/OrgMemoryProposalsPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/context/use-auth";
import { useOrgMemory, useUpdateOrgMemory } from "@/hooks/use-org-memory";
import { useOrgMemoryProposals } from "@/hooks/use-org-memory-proposals";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MAX_BODY_BYTES = 256_000;

type OrgMemoryTab = "live" | "proposals" | "history";

function formatUpdatedLabel(timestampMs: number): string {
  if (!timestampMs) {
    return "—";
  }

  const deltaMs = Date.now() - timestampMs;
  const seconds = Math.max(0, Math.round(deltaMs / 1000));

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return new Date(timestampMs).toLocaleDateString();
}

function OrgMemoryTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "-mb-px border-b-2 px-0 py-2.5 text-sm transition-colors",
        active
          ? "border-foreground font-semibold text-foreground"
          : "border-transparent font-normal text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function OrgMemoryPinnedContent({ pinned }: { pinned: string[] }) {
  if (pinned.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No pinned facts yet.</p>
    );
  }

  const [lead, ...details] = pinned;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center self-stretch">
        <div
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
        >
          <PinIcon className="size-3.5" strokeWidth={2.25} />
        </div>
        <div className="mt-2 w-px flex-1 bg-border" />
      </div>

      <div className="min-w-0 flex-1 space-y-3 pb-1">
        <p className="font-semibold text-2xs text-muted-foreground uppercase tracking-[0.08em]">
          PINNED
        </p>

        <div className="space-y-3">
          <p className="text-foreground text-sm leading-relaxed">{lead}</p>

          {details.length > 0 ? (
            <ul className="space-y-1.5">
              {details.map((detail, index) => (
                <li
                  className={cn(
                    "text-sm leading-relaxed",
                    index === details.length - 1
                      ? "font-mono text-muted-foreground/80 text-xs"
                      : "text-muted-foreground"
                  )}
                  key={detail}
                >
                  <span aria-hidden className="mr-1.5 select-none">
                    →
                  </span>
                  {detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OrgMemoryTabPanel({
  activeTab,
  orgId,
  isLoading,
  pinnedFacts,
}: {
  activeTab: OrgMemoryTab;
  orgId: string | null;
  isLoading: boolean;
  pinnedFacts: string[];
}) {
  if (activeTab === "proposals") {
    return orgId ? <OrgMemoryProposalsPanel orgId={orgId} /> : null;
  }

  if (activeTab === "history") {
    return orgId ? <OrgMemoryHistoryPanel orgId={orgId} /> : null;
  }

  return (
    <div className="px-4 py-3">
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <OrgMemoryPinnedContent pinned={pinnedFacts} />
      )}
    </div>
  );
}

function OrgMemoryEditDialog({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  formError,
  busy,
  dirty,
  draftBytes,
  savePending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  formError: string | null;
  busy: boolean;
  dirty: boolean;
  draftBytes: number;
  savePending: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 p-4 sm:max-w-3xl sm:gap-6 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>Edit org memory</DialogTitle>
          <DialogDescription>
            Raw Markdown. Keep the ## Org Memory / ## Pinned structure.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          <Textarea
            autoFocus
            className="field-sizing-fixed min-h-[min(52dvh,22rem)] flex-1 resize-none overflow-y-auto font-mono text-xs leading-relaxed sm:min-h-[min(58dvh,26rem)]"
            disabled={busy}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={"## Org Memory\n\n## Pinned\n- ..."}
            rows={12}
            value={draft}
          />
          {formError ? (
            <p className="text-destructive text-sm">{formError}</p>
          ) : null}
          <DialogFooter className="mx-0 mb-0 shrink-0 border-border border-t bg-transparent p-0 pt-4">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">
                {draftBytes} bytes
              </span>
              <Button disabled={busy || !dirty} size="sm" type="submit">
                {savePending ? <Spinner className="mr-2" /> : null}
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrgMemoryAdminCard({
  orgId,
  dataUpdatedAt,
  isLoading,
  loadError,
  liveContent,
  pinnedFacts,
  pendingCount,
  updateMutation,
}: {
  orgId: string | null;
  dataUpdatedAt: number;
  isLoading: boolean;
  loadError: unknown;
  liveContent: string;
  pinnedFacts: string[];
  pendingCount: number;
  updateMutation: ReturnType<typeof useUpdateOrgMemory>;
}) {
  const [activeTab, setActiveTab] = useState<OrgMemoryTab>("live");
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const draftBytes = new TextEncoder().encode(draft).byteLength;

  useEffect(() => {
    if (searchParams.get("orgMemory") === "proposals") {
      setActiveTab("proposals");
    }
  }, [searchParams]);

  function openEdit() {
    setFormError(null);
    setDraft(liveContent);
    setEditOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    if (draftBytes > MAX_BODY_BYTES) {
      setFormError(
        `Content is too large (${draftBytes} bytes; limit ${MAX_BODY_BYTES}).`
      );
      return;
    }
    try {
      await updateMutation.mutateAsync({ content: draft });
      setEditOpen(false);
      toast("Org memory saved.");
    } catch (err) {
      setFormError(formatError(err));
    }
  }

  const statusLine = formError ?? (loadError ? formatError(loadError) : null);
  const busy = updateMutation.isPending;
  const dirty = draft !== liveContent;
  const showPinnedFooter =
    activeTab === "live" && !isLoading && pinnedFacts.length > 0;

  return (
    <>
      <Card className="w-full overflow-hidden shadow-none">
        <div className="border-border border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-medium text-foreground text-sm">Org Memory</p>
              <p className="max-w-prose text-muted-foreground text-xs leading-relaxed">
                Shared facts for every agent. Review proposals before they go
                live.
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Edit org memory"
                    className="shrink-0"
                    onClick={openEdit}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <PencilIcon aria-hidden className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent side="top" sideOffset={8}>
                Edit
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="border-border border-b px-4">
          <div className="flex gap-5">
            <OrgMemoryTabButton
              active={activeTab === "live"}
              onClick={() => setActiveTab("live")}
            >
              Live memory
            </OrgMemoryTabButton>
            <OrgMemoryTabButton
              active={activeTab === "proposals"}
              onClick={() => setActiveTab("proposals")}
            >
              Proposals
              {pendingCount > 0 ? (
                <span className="ml-1 font-normal text-muted-foreground text-xs">
                  ({pendingCount > 99 ? "99+" : pendingCount})
                </span>
              ) : null}
            </OrgMemoryTabButton>
            <OrgMemoryTabButton
              active={activeTab === "history"}
              onClick={() => setActiveTab("history")}
            >
              History
            </OrgMemoryTabButton>
          </div>
        </div>

        <OrgMemoryTabPanel
          activeTab={activeTab}
          isLoading={isLoading}
          orgId={orgId}
          pinnedFacts={pinnedFacts}
        />

        {showPinnedFooter ? (
          <div className="flex items-center justify-between border-border border-t px-4 py-2 text-muted-foreground text-xs">
            <span>Pinned</span>
            <span>Updated {formatUpdatedLabel(dataUpdatedAt)}</span>
          </div>
        ) : null}

        {statusLine ? (
          <div className="border-border border-t px-4 py-2">
            <p className="text-destructive text-sm" role="alert">
              {statusLine}
            </p>
          </div>
        ) : null}
      </Card>

      <OrgMemoryEditDialog
        busy={busy}
        dirty={dirty}
        draft={draft}
        draftBytes={draftBytes}
        formError={formError}
        onDraftChange={setDraft}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setDraft("");
            setFormError(null);
          }
        }}
        onSave={() => void handleSave()}
        open={editOpen}
        savePending={updateMutation.isPending}
      />
    </>
  );
}

export function OrgMemoryCard() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const isAdmin = activeOrg?.role === "admin";

  const {
    data,
    isLoading,
    error: loadError,
    dataUpdatedAt,
  } = useOrgMemory(isAdmin ? orgId : null);
  const { data: proposalsData } = useOrgMemoryProposals(
    isAdmin ? orgId : null,
    "pending"
  );
  const updateMutation = useUpdateOrgMemory(orgId ?? "");

  if (!isAdmin) {
    return null;
  }

  const liveContent = data?.content ?? "";
  const pinnedFacts = parseOrgMemoryContent(liveContent).pinned;
  const pendingCount = proposalsData?.pendingCount ?? 0;

  return (
    <OrgMemoryAdminCard
      dataUpdatedAt={dataUpdatedAt}
      isLoading={isLoading}
      liveContent={liveContent}
      loadError={loadError}
      orgId={orgId}
      pendingCount={pendingCount}
      pinnedFacts={pinnedFacts}
      updateMutation={updateMutation}
    />
  );
}
