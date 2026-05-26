import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useProfileQuery, useProfilesQuery, useToolsQuery } from "@/hooks/use-app-queries";
import {
  useAssignToolMutation,
  useCreateProfileMutation,
  useDeleteProfileAvatarMutation,
  useDeleteProfileMutation,
  useInitProfileSoulMutation,
  useUnassignToolMutation,
  useUpdateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { cn } from "@/lib/utils";
import { fileToImageAttachment } from "@/lib/profile-images";
import { ImageIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { formatError } from "@/lib/client";

const defaultCreatePrompt = "You are a helpful assistant.";

const sectionClass = "rounded-md border border-border bg-card p-4";

export function ProfilesPage() {
  const { data: profiles = [], isLoading: profilesLoading, error: profilesError } =
    useProfilesQuery();
  const { data: allTools = [] } = useToolsQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    data: detail = null,
    error: detailError,
  } = useProfileQuery(selectedId);
  const createMutation = useCreateProfileMutation();
  const updateMutation = useUpdateProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const deleteAvatarMutation = useDeleteProfileAvatarMutation();
  const assignMutation = useAssignToolMutation();
  const unassignMutation = useUnassignToolMutation();
  const initSoulMutation = useInitProfileSoulMutation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPrompt, setCreatePrompt] = useState(defaultCreatePrompt);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [assignToolId, setAssignToolId] = useState("");

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    uploadAvatarMutation.isPending ||
    deleteAvatarMutation.isPending ||
    assignMutation.isPending ||
    unassignMutation.isPending ||
    initSoulMutation.isPending;

  useEffect(() => {
    const queryError = profilesError ?? detailError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, detailError]);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(profiles[0]!.id);
    }
  }, [profiles, selectedId]);

  useEffect(() => {
    if (detail) {
      setEditName(detail.name);
      setEditPrompt(detail.systemPrompt);
    }
  }, [detail]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!createName.trim()) {
      return;
    }

    setError(null);

    try {
      const response = await createMutation.mutateAsync({
        name: createName.trim(),
        systemPrompt: createPrompt.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateName("");
      setCreatePrompt(defaultCreatePrompt);
      setSelectedId(response.profile.id);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleSave() {
    if (!selectedId || !detail) {
      return;
    }

    setError(null);

    try {
      await updateMutation.mutateAsync({
        profileId: selectedId,
        input: {
          name: editName.trim(),
          systemPrompt: editPrompt,
        },
      });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleDelete() {
    if (!selectedId || !detail || detail.isSuper) {
      return;
    }

    if (!window.confirm(`Delete profile "${detail.name}"?`)) {
      return;
    }

    setError(null);

    try {
      await deleteMutation.mutateAsync(selectedId);
      setSelectedId(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAssignTool() {
    if (!selectedId || !assignToolId) {
      return;
    }

    setError(null);

    try {
      await assignMutation.mutateAsync({ profileId: selectedId, toolId: assignToolId });
      setAssignToolId("");
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleUnassignTool(toolId: string) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      await unassignMutation.mutateAsync({ profileId: selectedId, toolId });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleInitSoul() {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      await initSoulMutation.mutateAsync(selectedId);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAvatarSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!selectedId || !file) {
      return;
    }

    setError(null);

    try {
      const attachment = await fileToImageAttachment(file);

      if (!attachment) {
        setError("Could not read the selected image.");
        return;
      }

      await uploadAvatarMutation.mutateAsync({ profileId: selectedId, attachment });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleRemoveAvatar() {
    if (!selectedId || !detail?.hasAvatar) {
      return;
    }

    setError(null);

    try {
      await deleteAvatarMutation.mutateAsync(selectedId);
    } catch (err) {
      setError(formatError(err));
    }
  }

  const availableTools = allTools.filter(
    (tool) => !detail?.tools.some((assigned) => assigned.id === tool.id),
  );

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);

    if (!open) {
      setCreateName("");
      setCreatePrompt(defaultCreatePrompt);
    }
  }

  if (profilesLoading) {
    return <PageState message="Loading profiles…" />;
  }

  return (
    <>
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section className={sectionClass}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="type-section-title">Profiles</h2>
            <p className="text-xs text-muted-foreground">{profiles.length} total</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon />
            New
          </Button>
        </div>

        <div className="space-y-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => setSelectedId(profile.id)}
              className={cn(
                "w-full rounded-md border px-3 py-3 text-left transition",
                selectedId === profile.id
                  ? "border-primary/40 bg-muted"
                  : "border-border bg-transparent hover:bg-muted/50"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar profile={profile} size="sm" />
                  <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
                </div>
                {profile.isSuper ? (
                  <span className="type-badge rounded-md bg-primary/15 px-2 py-0.5 text-primary">
                    Super
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {profile.toolCount} tools · soul {profile.soulActive ? "active" : "inactive"}
              </p>
            </button>
          ))}
        </div>

      </section>

      <section className="space-y-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {detail ? (
          <>
            <div className={cn(sectionClass, "p-5")}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-4">
                  <ProfileAvatar profile={detail} size="lg" />
                  <div>
                    <h2 className="type-page-title">{detail.name}</h2>
                    <p className="type-code mt-1 text-muted-foreground">{detail.id}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        disabled={busy}
                        onChange={(event) => void handleAvatarSelected(event)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={busy}
                        aria-label="Upload avatar"
                        title="Upload avatar"
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <ImageIcon />
                      </Button>
                      {detail.hasAvatar ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={busy}
                          aria-label="Remove avatar"
                          title="Remove avatar"
                          onClick={() => void handleRemoveAvatar()}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleInitSoul()}
                  >
                    Init soul
                  </Button>
                  {!detail.isSuper ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleDelete()}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={editName}
                    disabled={busy}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </Field>
                <Field label="Model">
                  <Input value={detail.model ?? "inherit global"} disabled readOnly />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="System prompt">
                  <Textarea
                    className="min-h-40 font-mono text-xs leading-relaxed"
                    value={editPrompt}
                    disabled={busy}
                    onChange={(event) => setEditPrompt(event.target.value)}
                  />
                </Field>
              </div>

              <div className="mt-4 flex justify-end">
                <Button type="button" disabled={busy} onClick={() => void handleSave()}>
                  Save changes
                </Button>
              </div>
            </div>

            <div className={cn(sectionClass, "p-5")}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="type-section-title">Allowed tools</h3>
                <div className="flex gap-2">
                  <Select
                    value={assignToolId}
                    disabled={busy || availableTools.length === 0}
                    onValueChange={(value) => setAssignToolId(value != null ? String(value) : "")}
                  >
                    <SelectTrigger className="h-8 w-48">
                      <SelectValue placeholder="Assign tool…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTools.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id}>
                          {tool.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !assignToolId}
                    onClick={() => void handleAssignTool()}
                  >
                    Assign
                  </Button>
                </div>
              </div>

              {detail.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tools assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{tool.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                        <p className="type-code mt-1 text-muted-foreground/80">
                          {tool.handlerType}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => void handleUnassignTool(tool.id)}
                      >
                        Detach
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <PageState message="Select a profile to inspect or edit it." />
        )}
      </section>
    </div>

    <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <form className="space-y-6" onSubmit={(event) => void handleCreate(event)}>
          <DialogHeader className="gap-3">
            <DialogTitle>Create profile</DialogTitle>
            <DialogDescription>
              Add a bot profile with a name and system prompt. You can assign tools after
              creating it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <Field label="Name" className="space-y-3">
              <Input
                placeholder="e.g. Research assistant"
                value={createName}
                disabled={busy}
                autoFocus
                onChange={(event) => setCreateName(event.target.value)}
              />
            </Field>
            <Field label="System prompt" className="space-y-3">
              <Textarea
                className="min-h-36 font-mono text-sm"
                placeholder="You are a helpful assistant."
                value={createPrompt}
                disabled={busy}
                onChange={(event) => setCreatePrompt(event.target.value)}
              />
            </Field>
          </div>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => handleCreateOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !createName.trim()}>
              Create profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <label className="type-label">
        {label}
      </label>
      {children}
    </div>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div
      className={cn(
        sectionClass,
        "flex min-h-64 items-center justify-center p-8 text-sm text-muted-foreground"
      )}
    >
      {message}
    </div>
  );
}
