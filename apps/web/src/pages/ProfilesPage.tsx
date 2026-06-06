import type { ProfileSummary } from "@tinyclaw/core/contract";
import {
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { McpServerAssignPicker } from "@/components/McpServerAssignPicker";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import {
  useMcpServersQuery,
  useProfileQuery,
  useProfilesQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  useAssignMcpServerMutation,
  useAssignToolMutation,
  useCreateProfileMutation,
  useDeleteProfileAvatarMutation,
  useDeleteProfileMutation,
  useUnassignMcpServerMutation,
  useUnassignToolMutation,
  useUpdateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { cn } from "@/lib/utils";
import { fileToImageAttachment } from "@/lib/profile-images";
import { formatError } from "@/lib/client";

const defaultCreatePrompt = "You are a helpful assistant.";
const sectionClass = "rounded-md border border-border bg-card";
const profilesTagline = "Separate prompt, tools, and soul for each bot.";
const profileSaveDelayMs = 600;

type ProfileSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type RemoveAssignmentTarget =
  | { kind: "tool"; id: string; name: string }
  | { kind: "mcp"; id: string; name: string };

export function ProfilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: profiles = [],
    isLoading: profilesLoading,
    isFetching: profilesRefreshing,
    error: profilesError,
    refetch: refetchProfiles,
  } = useProfilesQuery();
  const { data: allTools = [] } = useToolsQuery();
  const { data: allMcpServers = [] } = useMcpServersQuery();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const profileInitializedRef = useRef(false);
  const {
    data: detail = null,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useProfileQuery(selectedId);
  const createMutation = useCreateProfileMutation();
  const updateMutation = useUpdateProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const deleteAvatarMutation = useDeleteProfileAvatarMutation();
  const assignMutation = useAssignToolMutation();
  const unassignMutation = useUnassignToolMutation();
  const assignMcpMutation = useAssignMcpServerMutation();
  const unassignMcpMutation = useUnassignMcpServerMutation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const createAvatarInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<RemoveAssignmentTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPrompt, setCreatePrompt] = useState(defaultCreatePrompt);
  const [createAvatarFile, setCreateAvatarFile] = useState<File | null>(null);
  const [createAvatarPreview, setCreateAvatarPreview] = useState<string | null>(null);
  const [createToolIds, setCreateToolIds] = useState<string[]>([]);
  const [createAssignToolId, setCreateAssignToolId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [savedName, setSavedName] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>("idle");
  const [assignToolId, setAssignToolId] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const editStateRef = useRef({
    editName,
    editPrompt,
    savedName,
    savedPrompt,
    selectedId,
    detail,
  });
  editStateRef.current = {
    editName,
    editPrompt,
    savedName,
    savedPrompt,
    selectedId,
    detail,
  };

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    uploadAvatarMutation.isPending ||
    deleteAvatarMutation.isPending ||
    assignMutation.isPending ||
    unassignMutation.isPending ||
    assignMcpMutation.isPending ||
    unassignMcpMutation.isPending;

  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;
  const refreshing = profilesRefreshing || (detailLoading && Boolean(selectedId));

  const isDirty = useMemo(() => {
    if (!detail) {
      return false;
    }

    return editName.trim() !== savedName || editPrompt !== savedPrompt;
  }, [detail, editName, editPrompt, savedName, savedPrompt]);

  const performSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      return true;
    }

    const {
      editName: nameDraft,
      editPrompt: promptDraft,
      savedName: baselineName,
      savedPrompt: baselinePrompt,
      selectedId: profileId,
      detail: profileDetail,
    } = editStateRef.current;

    if (!profileId || !profileDetail) {
      return true;
    }

    const name = nameDraft.trim();
    if (!name) {
      return false;
    }

    if (name === baselineName && promptDraft === baselinePrompt) {
      setSaveStatus("idle");
      return true;
    }

    savingRef.current = true;
    setSaveStatus("saving");
    setError(null);

    try {
      await updateMutation.mutateAsync({
        profileId,
        input: {
          name,
          systemPrompt: promptDraft,
        },
      });
      setSavedName(name);
      setSavedPrompt(promptDraft);
      setSaveStatus("saved");

      if (savedHintTimerRef.current) {
        clearTimeout(savedHintTimerRef.current);
      }

      savedHintTimerRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);

      return true;
    } catch (err) {
      setSaveStatus("error");
      setError(formatError(err));
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [updateMutation]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    const {
      editName: nameDraft,
      editPrompt: promptDraft,
      savedName: baselineName,
      savedPrompt: baselinePrompt,
      selectedId: profileId,
      detail: profileDetail,
    } = editStateRef.current;

    if (!profileId || !profileDetail) {
      return;
    }

    const name = nameDraft.trim();
    if (!name) {
      setSaveStatus("idle");
      return;
    }

    if (name === baselineName && promptDraft === baselinePrompt) {
      setSaveStatus("idle");
      return;
    }

    setSaveStatus("pending");
    saveTimerRef.current = setTimeout(() => {
      void performSave();
    }, profileSaveDelayMs);
  }, [performSave]);

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    return performSave();
  }, [performSave]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedId),
    [profiles, selectedId],
  );

  const setSelectedId = useCallback(
    (nextProfileId: string | null) => {
      setSelectedIdState(nextProfileId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextProfileId) {
            next.set("profile", nextProfileId);
          } else {
            next.delete("profile");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    const queryError = profilesError ?? detailError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, detailError]);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedIdState(null);
      return;
    }

    if (profileInitializedRef.current) {
      if (selectedId && !profiles.some((profile) => profile.id === selectedId)) {
        setSelectedId(profiles[0]!.id);
      }
      return;
    }

    profileInitializedRef.current = true;
    const fromUrl = searchParams.get("profile");
    const matchedProfile = fromUrl ? profiles.find((profile) => profile.id === fromUrl) : null;
    const defaultProfile =
      matchedProfile ??
      profiles.find((profile) => profile.id === "profile_default") ??
      profiles[0]!;

    setSelectedId(defaultProfile.id);
  }, [profiles, searchParams, selectedId, setSelectedId]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    setEditName(detail.name);
    setEditPrompt(detail.systemPrompt);
    setSavedName(detail.name);
    setSavedPrompt(detail.systemPrompt);
    setSaveStatus("idle");
  }, [detail?.id]);

  useEffect(() => {
    scheduleSave();

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [editName, editPrompt, scheduleSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      if (savedHintTimerRef.current) {
        clearTimeout(savedHintTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (createAvatarPreview) {
        URL.revokeObjectURL(createAvatarPreview);
      }
    };
  }, [createAvatarPreview]);

  const filteredProfiles = useMemo(() => {
    const query = trimmedSearch.toLowerCase();
    if (!query) {
      return profiles;
    }

    return profiles.filter((profile) => {
      return profile.name.toLowerCase().includes(query) || profile.id.toLowerCase().includes(query);
    });
  }, [profiles, trimmedSearch]);

  const availableTools = allTools.filter(
    (tool) => !detail?.tools.some((assigned) => assigned.id === tool.id),
  );

  const availableMcpServers = allMcpServers.filter(
    (server) => !detail?.mcpServers.some((assigned) => assigned.id === server.id),
  );

  const createAvailableTools = allTools.filter((tool) => !createToolIds.includes(tool.id));

  async function handleSelectProfile(profileId: string) {
    if (profileId === selectedId) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const { editName: nameDraft, editPrompt: promptDraft, savedName: baselineName, savedPrompt: baselinePrompt } =
      editStateRef.current;
    const hasPendingEdits =
      nameDraft.trim() !== baselineName || promptDraft !== baselinePrompt;

    if (hasPendingEdits && nameDraft.trim()) {
      const saved = await performSave();
      if (!saved) {
        return;
      }
    }

    setSelectedId(profileId);
  }

  function resetCreateAvatar() {
    setCreateAvatarPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setCreateAvatarFile(null);
  }

  function handleCreateAvatarSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    resetCreateAvatar();
    setCreateAvatarFile(file);
    setCreateAvatarPreview(URL.createObjectURL(file));
  }

  function handleAddCreateTool() {
    if (!createAssignToolId || createToolIds.includes(createAssignToolId)) {
      return;
    }

    setCreateToolIds((current) => [...current, createAssignToolId]);
    setCreateAssignToolId("");
  }

  function handleRemoveCreateTool(toolId: string) {
    setCreateToolIds((current) => current.filter((id) => id !== toolId));
  }

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

      if (createAvatarFile) {
        const attachment = await fileToImageAttachment(createAvatarFile);

        if (!attachment) {
          setError("Profile created, but the selected image could not be read.");
        } else {
          await uploadAvatarMutation.mutateAsync({
            profileId: response.profile.id,
            attachment,
          });
        }
      }

      for (const toolId of createToolIds) {
        await assignMutation.mutateAsync({
          profileId: response.profile.id,
          toolId,
        });
      }

      handleCreateOpenChange(false);
      setSelectedId(response.profile.id);
    } catch (err) {
      setError(formatError(err));
    }
  }


  async function handleDeleteConfirm() {
    if (!selectedId || !detail || detail.isSuper) {
      return;
    }

    setError(null);

    try {
      await deleteMutation.mutateAsync(selectedId);
      setDeleteOpen(false);
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

  async function handleAssignMcpServer(serverId: string) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      await assignMcpMutation.mutateAsync({
        profileId: selectedId,
        serverId,
      });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleRemoveAssignmentConfirm() {
    if (!selectedId || !removeConfirm) {
      return;
    }

    setError(null);

    try {
      if (removeConfirm.kind === "tool") {
        await unassignMutation.mutateAsync({ profileId: selectedId, toolId: removeConfirm.id });
      } else {
        await unassignMcpMutation.mutateAsync({ profileId: selectedId, serverId: removeConfirm.id });
      }

      setRemoveConfirm(null);
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

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);

    if (!open) {
      setCreateName("");
      setCreatePrompt(defaultCreatePrompt);
      setCreateToolIds([]);
      setCreateAssignToolId("");
      resetCreateAvatar();
    }
  }

  async function refresh() {
    setError(null);
    await Promise.all([
      refetchProfiles(),
      selectedId ? refetchDetail() : Promise.resolve(),
    ]);
  }

  const profileSubtitle = detail
    ? [
        detail.id,
        detail.isSuper ? "super" : null,
        `${detail.tools.length} tools`,
        detail.soulActive ? "soul active" : "soul inactive",
      ]
        .filter(Boolean)
        .join(" · ")
    : selectedProfile
      ? [
          selectedProfile.id,
          `${selectedProfile.toolCount} tools`,
          selectedProfile.soulActive ? "soul active" : "soul inactive",
        ].join(" · ")
      : "";

  if (profilesLoading && profiles.length === 0) {
    return <PageState message="Loading profiles…" />;
  }

  return (
    <>
      <div className="space-y-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
            {selectedId ? (
              <>
                {" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void refetchDetail()}
                >
                  Retry
                </button>
              </>
            ) : null}
          </p>
        ) : null}

        <section className={cn(sectionClass, "overflow-hidden")}>
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:hidden">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={selectedId ?? undefined}
                disabled={busy || refreshing || profiles.length === 0}
                onValueChange={(value) => {
                  if (value) {
                    handleSelectProfile(String(value));
                  }
                }}
              >
                <SelectTrigger className="min-w-0 flex-1" aria-label="Selected profile">
                  <SelectValue placeholder="Select profile">
                    {filteredProfiles.find((profile) => profile.id === selectedId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      <span className="flex items-center gap-2">
                        <ProfileAvatar profile={profile} size="sm" />
                        <span>{profile.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || refreshing}
                  aria-label="Refresh profiles"
                  onClick={() => void refresh()}
                >
                  {refreshing ? (
                    <Spinner className="size-4" />
                  ) : (
                    <RefreshCwIcon className="size-4" aria-hidden />
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => setCreateOpen(true)}
                >
                  <PlusIcon className="size-4" aria-hidden />
                  New
                </Button>
              </div>
            </div>

            {profiles.length > 0 ? (
              <ProfileSearch
                value={searchQuery}
                disabled={profilesLoading || busy}
                isSearching={isSearching}
                onChange={setSearchQuery}
                onClear={() => setSearchQuery("")}
              />
            ) : null}
          </div>

          <div className="grid gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden border-b border-border p-4 lg:block lg:border-r lg:border-b-0">
              <div className="mb-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="type-section-title">Profiles</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || refreshing}
                      aria-label="Refresh profiles"
                      onClick={() => void refresh()}
                    >
                      {profilesRefreshing ? (
                        <Spinner className="size-4" />
                      ) : (
                        <RefreshCwIcon className="size-4" aria-hidden />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => setCreateOpen(true)}
                    >
                      <PlusIcon className="size-4" aria-hidden />
                      New
                    </Button>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{profilesTagline}</p>
              </div>

              {profiles.length > 0 ? (
                <div className="mb-4">
                  <ProfileSearch
                    value={searchQuery}
                    disabled={profilesLoading || busy}
                    isSearching={isSearching}
                    onChange={setSearchQuery}
                    onClear={() => setSearchQuery("")}
                  />
                </div>
              ) : null}

              {profiles.length === 0 ? (
                <ProfilesEmptyState
                  variant="compact"
                  disabled={busy}
                  onCreate={() => setCreateOpen(true)}
                />
              ) : filteredProfiles.length === 0 ? (
                <EmptyMessage
                  message="No profiles match your search."
                  actionLabel="Clear search"
                  onAction={() => setSearchQuery("")}
                />
              ) : (
                <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 lg:max-h-none">
                  {filteredProfiles.map((profile) => (
                    <ProfileScopeButton
                      key={profile.id}
                      profile={profile}
                      active={selectedId === profile.id}
                      disabled={busy}
                      onClick={() => handleSelectProfile(profile.id)}
                    />
                  ))}
                </div>
              )}

              {profiles.length > 0 ? (
                <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs dark:bg-muted/30">
                  <p className="font-medium text-foreground">How it works</p>
                  <p className="mt-2">
                    Profiles isolate prompts and tool access. Edit settings here, then open Soul to
                    customize voice and identity per profile.
                  </p>
                </div>
              ) : null}
            </aside>

            <div className="min-w-0 p-4 sm:p-5">
              {profiles.length === 0 ? (
                <ProfilesEmptyState
                  variant="full"
                  disabled={busy}
                  onCreate={() => setCreateOpen(true)}
                />
              ) : detailLoading && !detail ? (
                <PageState message="Loading profile…" embedded />
              ) : !selectedId || !detail ? (
                <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                  Select a profile to edit.
                </div>
              ) : (
                <>
                  <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <ProfileAvatar profile={detail} size="lg" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="type-section-title">{detail.name}</h2>
                          {detail.soulActive ? (
                            <span className="scope-badge scope-badge-active">soul active</span>
                          ) : null}
                          {detail.isSuper ? (
                            <span className="scope-badge bg-muted text-muted-foreground">super</span>
                          ) : null}
                        </div>
                        <p className="type-body mt-1 text-xs">{profileSubtitle}</p>
                        <ProfileSaveIndicator
                          saveStatus={saveStatus}
                          nameMissing={isDirty && !editName.trim()}
                        />
                      </div>
                    </div>

                    <div className="hidden shrink-0 flex-wrap items-center gap-2 lg:flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || refreshing}
                        onClick={() => void refresh()}
                      >
                        {refreshing ? (
                          <Spinner className="size-4" />
                        ) : (
                          <RefreshCwIcon className="size-4" aria-hidden />
                        )}
                        Refresh
                      </Button>
                      {!detail.isSuper ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteOpen(true)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2 lg:hidden">
                    {!detail.isSuper ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteOpen(true)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>

                  <div className="space-y-5">
                    <div className="flex flex-wrap gap-2">
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
                        size="sm"
                        disabled={busy || uploadAvatarMutation.isPending}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {uploadAvatarMutation.isPending ? (
                          <Spinner className="size-4" />
                        ) : (
                          "Upload avatar"
                        )}
                      </Button>
                      {detail.hasAvatar ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || deleteAvatarMutation.isPending}
                          onClick={() => void handleRemoveAvatar()}
                        >
                          {deleteAvatarMutation.isPending ? (
                            <Spinner className="size-4" />
                          ) : (
                            "Remove avatar"
                          )}
                        </Button>
                      ) : null}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Name" htmlFor="profile-name">
                        <Input
                          id="profile-name"
                          value={editName}
                          disabled={busy}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </Field>
                      <Field label="Model" htmlFor="profile-model">
                        <Input
                          id="profile-model"
                          value={detail.model ?? "inherit global"}
                          disabled
                          readOnly
                        />
                      </Field>
                    </div>

                    <ExpandableTextarea
                      label="System prompt"
                      htmlFor="profile-prompt"
                      dialogDescription="Instructions sent to the model at the start of each chat."
                      value={editPrompt}
                      disabled={busy}
                      onChange={(event) => setEditPrompt(event.target.value)}
                      onSave={flushSave}
                    />

                    <div className="border-t border-border pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">Allowed tools</h3>
                          <p className="type-body mt-1 text-xs">
                            {detail.tools.length === 0
                              ? "No tools assigned to this profile."
                              : `${detail.tools.length} assigned`}
                          </p>
                        </div>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                          <Select
                            value={assignToolId}
                            disabled={busy || availableTools.length === 0}
                            onValueChange={(value) =>
                              setAssignToolId(value != null ? String(value) : "")
                            }
                          >
                            <SelectTrigger className="w-full sm:w-44" aria-label="Tool to assign">
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
                        <p className="type-body text-xs">No tools assigned.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.tools.map((tool) => (
                            <li
                              key={tool.id}
                              className="flex items-start justify-between gap-3 px-4 py-3 first:rounded-t-md last:rounded-b-md"
                            >
                              <div className="min-w-0">
                                <p className="text-sm text-foreground">{tool.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {tool.description}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Remove ${tool.name}`}
                                onClick={() =>
                                  setRemoveConfirm({ kind: "tool", id: tool.id, name: tool.name })
                                }
                              >
                                <Trash2Icon className="size-4" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="border-t border-border pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">Allowed MCP servers</h3>
                          <p className="type-body mt-1 text-xs">
                            {detail.mcpServers.length === 0
                              ? "No MCP servers assigned to this profile."
                              : `${detail.mcpServers.length} assigned`}
                          </p>
                        </div>
                        <McpServerAssignPicker
                          servers={availableMcpServers}
                          disabled={busy}
                          onAssign={handleAssignMcpServer}
                        />
                      </div>

                      {detail.mcpServers.length === 0 ? (
                        <p className="type-body text-xs">No MCP servers assigned.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.mcpServers.map((server) => (
                            <li
                              key={server.id}
                              className="flex items-start justify-between gap-3 px-4 py-3 first:rounded-t-md last:rounded-b-md"
                            >
                              <div className="min-w-0">
                                <p className="text-sm text-foreground">{server.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {server.transport} · {server.toolCount} tool
                                  {server.toolCount === 1 ? "" : "s"}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Remove ${server.name}`}
                                onClick={() =>
                                  setRemoveConfirm({ kind: "mcp", id: server.id, name: server.name })
                                }
                              >
                                <Trash2Icon className="size-4" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="type-body mt-5 rounded-md border border-border bg-muted/40 p-3 text-xs lg:hidden dark:bg-muted/30">
                    <p className="font-medium text-foreground">How it works</p>
                    <p className="mt-2">
                      Profiles isolate prompts and tool access. Open Soul to customize voice and
                      identity per profile.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <form className="space-y-6" onSubmit={(event) => void handleCreate(event)}>
            <DialogHeader className="gap-2">
              <DialogTitle>Create profile</DialogTitle>
              <DialogDescription>Name and system prompt for the new bot profile.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Field label="Avatar">
                <div className="flex items-center gap-3">
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                    {createAvatarPreview ? (
                      <img
                        src={createAvatarPreview}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-medium text-muted-foreground">
                        {createName.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={createAvatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      disabled={busy}
                      onChange={handleCreateAvatarSelected}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => createAvatarInputRef.current?.click()}
                    >
                      Choose image
                    </Button>
                    {createAvatarPreview ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={resetCreateAvatar}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Field>
              <Field label="Name" htmlFor="create-profile-name">
                <Input
                  id="create-profile-name"
                  placeholder="Research assistant"
                  value={createName}
                  disabled={busy}
                  autoFocus
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </Field>
              <ExpandableTextarea
                label="System prompt"
                htmlFor="create-profile-prompt"
                value={createPrompt}
                disabled={busy}
                onChange={(event) => setCreatePrompt(event.target.value)}
              />
              <Field label="Tools">
                {allTools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tools available.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select
                        value={createAssignToolId}
                        disabled={busy || createAvailableTools.length === 0}
                        onValueChange={(value) =>
                          setCreateAssignToolId(value != null ? String(value) : "")
                        }
                      >
                        <SelectTrigger className="w-full" aria-label="Tool to assign">
                          <SelectValue placeholder="Assign tool…" />
                        </SelectTrigger>
                        <SelectContent>
                          {createAvailableTools.map((tool) => (
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
                        className="shrink-0"
                        disabled={busy || !createAssignToolId}
                        onClick={handleAddCreateTool}
                      >
                        Add
                      </Button>
                    </div>
                    {createToolIds.length > 0 ? (
                      <ul className="divide-y divide-border rounded-md border border-border">
                        {createToolIds.map((toolId) => {
                          const tool = allTools.find((entry) => entry.id === toolId);
                          if (!tool) {
                            return null;
                          }

                          return (
                            <li
                              key={toolId}
                              className="flex items-center justify-between gap-2 px-3 py-2"
                            >
                              <span className="min-w-0 truncate text-sm text-foreground">
                                {tool.name}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="shrink-0 text-muted-foreground"
                                disabled={busy}
                                onClick={() => handleRemoveCreateTool(toolId)}
                              >
                                Remove
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                )}
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
                {createMutation.isPending ||
                uploadAvatarMutation.isPending ||
                assignMutation.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  "Create"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRemoveConfirm(null);
          }
        }}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>
              {removeConfirm?.kind === "mcp" ? "Remove MCP server?" : "Remove tool?"}
            </DialogTitle>
            <DialogDescription>
              {removeConfirm?.kind === "mcp"
                ? `Remove "${removeConfirm.name}" from this profile? The server stays registered in Soul.`
                : `Remove "${removeConfirm?.name}" from this profile?`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setRemoveConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleRemoveAssignmentConfirm()}
            >
              {unassignMutation.isPending || unassignMcpMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                "Remove"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteOpen(false);
          }
        }}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete profile?</DialogTitle>
            <DialogDescription>
              This removes {detail?.name} and its chat history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDeleteConfirm()}
            >
              {deleteMutation.isPending ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfileSaveIndicator({
  saveStatus,
  nameMissing,
}: {
  saveStatus: ProfileSaveStatus;
  nameMissing: boolean;
}) {
  if (nameMissing) {
    return (
      <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
        Name is required
      </p>
    );
  }

  if (saveStatus === "pending" || saveStatus === "saving") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Saving…
      </p>
    );
  }

  if (saveStatus === "saved") {
    return (
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        Saved
      </p>
    );
  }

  if (saveStatus === "error") {
    return (
      <p className="mt-2 text-xs font-medium text-destructive" role="status">
        Save failed
      </p>
    );
  }

  return null;
}

function ProfileScopeButton({
  profile,
  active,
  disabled,
  onClick,
}: {
  profile: ProfileSummary;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-active={active || undefined}
      className="scope-item disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-start gap-3">
        <ProfileAvatar profile={profile} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "truncate text-sm font-medium",
                active ? "text-primary" : "text-foreground",
              )}
            >
              {profile.name}
            </p>
            {profile.soulActive ? (
              <span className="scope-badge scope-badge-active">active</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {profile.toolCount} tools · soul {profile.soulActive ? "on" : "off"}
          </p>
        </div>
      </div>
    </button>
  );
}

function ProfileSearch({
  value,
  disabled,
  isSearching,
  onChange,
  onClear,
}: {
  value: string;
  disabled: boolean;
  isSearching: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search…"
        disabled={disabled}
        className={cn("pl-9", isSearching && "pr-9")}
        aria-label="Search profiles"
      />
      {isSearching ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

const profileEmptySteps = [
  {
    title: "Create a profile",
    description: "Give it a name, avatar, and system prompt.",
  },
  {
    title: "Assign tools",
    description: "Control which capabilities this bot can use.",
  },
  {
    title: "Customize in Soul",
    description: "Set voice and identity per profile when you are ready.",
  },
] as const;

function ProfilesEmptyState({
  variant,
  disabled,
  onCreate,
}: {
  variant: "compact" | "full";
  disabled?: boolean;
  onCreate: () => void;
}) {
  const isCompact = variant === "compact";

  return (
    <div
      role="status"
      aria-labelledby="profiles-empty-title"
      className={cn(
        "text-center",
        isCompact
          ? "flex flex-col items-center gap-3 rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-6"
          : "flex min-h-[min(20rem,50dvh)] flex-col items-center justify-center gap-6 px-4 py-10 sm:px-6",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center border border-border bg-muted/40",
          isCompact ? "size-10 rounded-full" : "size-14 rounded-2xl",
        )}
      >
        <UsersRoundIcon
          className={cn("text-muted-foreground", isCompact ? "size-4" : "size-6")}
          aria-hidden
        />
      </div>

      <div className={cn("space-y-1.5", !isCompact && "max-w-sm")}>
        <p
          id="profiles-empty-title"
          className={cn(
            "font-medium text-foreground",
            isCompact ? "text-sm" : "type-section-title",
          )}
        >
          {isCompact ? "No profiles yet" : "Create your first profile"}
        </p>
        {!isCompact ? (
          <p className="type-body text-sm text-muted-foreground">{profilesTagline}</p>
        ) : null}
      </div>

      <Button type="button" size={isCompact ? "sm" : "default"} disabled={disabled} onClick={onCreate}>
        <PlusIcon className="size-4" aria-hidden />
        {isCompact ? "Create profile" : "New profile"}
      </Button>

      {!isCompact ? (
        <ol className="w-full max-w-md space-y-3 border-t border-border pt-6 text-left">
          {profileEmptySteps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground"
                aria-hidden
              >
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function EmptyMessage({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/60 px-3 py-8 text-center" role="status">
      <p className="type-body text-xs text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function PageState({ message, embedded = false }: { message: string; embedded?: boolean }) {
  return (
    <div
      className={cn(
        embedded
          ? "flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          : cn(
              sectionClass,
              "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
            ),
      )}
    >
      <Spinner className="size-5" />
      {message}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-xs text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
