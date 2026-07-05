import type {
  CreateMcpServerRequest,
  CreateSkillRequest,
  ProfileSummary,
} from "@tinyclaw/core/contract";
import {
  CameraIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ArtifactsTab } from "@/components/soul-tools/ArtifactsTab";
import { KnowledgeTab } from "@/components/soul-tools/KnowledgeTab";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { McpServerAssignPicker } from "@/components/McpServerAssignPicker";
import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { SkillAssignPicker } from "@/components/SkillAssignPicker";
import { SkillCreateDialog } from "@/components/SkillCreateDialog";
import { SkillDetailDialog } from "@/components/SkillDetailDialog";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
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
  useModelsQuery,
  useProfileQuery,
  useProfilesQuery,
  useSkillsQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  useAssignMcpServerMutation,
  useAssignSkillMutation,
  useAssignToolMutation,
  useCreateMcpServerMutation,
  useCreateSkillMutation,
  useDeleteProfileMutation,
  useDeleteSkillMutation,
  useUnassignMcpServerMutation,
  useUnassignSkillMutation,
  useUnassignToolMutation,
  useUpdateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { cn } from "@/lib/utils";
import { fileToImageAttachment } from "@/lib/profile-images";
import { formatError } from "@/lib/client";
import {
  encodeModelSelection,
  extractModelId,
  groupModelsByProvider,
  modelSelectContentMaxHeightClass,
  profileModelLabel,
  profileModelSelectionValue,
} from "@/lib/models";

const sectionClass = "rounded-md border border-border bg-card";
const identityBoxClass = "p-3";
const profilesTagline = "Separate prompt, tools, and knowledge for each bot.";
const profileTextSaveDelayMs = 1000;
const profileModelSaveDelayMs = 400;

type ProfileSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type ProfileDetailTab = "profile" | "prompt" | "knowledge" | "artifacts";

function resolveProfileDetailTab(value: string | null): ProfileDetailTab {
  if (value === "prompt" || value === "knowledge" || value === "artifacts") {
    return value;
  }

  if (value === "soul") {
    return "prompt";
  }

  return "profile";
}

type ProfileEditSnapshot = {
  editName: string;
  editPrompt: string;
  editModel: string | null;
  savedName: string;
  savedPrompt: string;
  savedModel: string | null;
};

function profileHasPendingEdits(snapshot: ProfileEditSnapshot): boolean {
  const name = snapshot.editName.trim();
  if (!name) {
    return false;
  }

  return (
    name !== snapshot.savedName ||
    snapshot.editPrompt !== snapshot.savedPrompt ||
    snapshot.editModel !== snapshot.savedModel
  );
}

type RemoveAssignmentTarget =
  | { kind: "tool"; id: string; name: string }
  | { kind: "mcp"; id: string; name: string }
  | { kind: "skill"; id: string; name: string };

export function ProfilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: profiles = [],
    isLoading: profilesLoading,
    isFetching: profilesRefreshing,
    error: profilesError,
  } = useProfilesQuery();
  const { data: allTools = [] } = useToolsQuery();
  const { data: allMcpServers = [] } = useMcpServersQuery();
  const { data: allSkills = [] } = useSkillsQuery();
  const { data: modelsResponse } = useModelsQuery();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const profileInitializedRef = useRef(false);
  const {
    data: detail = null,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useProfileQuery(selectedId);
  const updateMutation = useUpdateProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const assignMutation = useAssignToolMutation();
  const unassignMutation = useUnassignToolMutation();
  const assignMcpMutation = useAssignMcpServerMutation();
  const unassignMcpMutation = useUnassignMcpServerMutation();
  const createMcpMutation = useCreateMcpServerMutation();
  const createSkillMutation = useCreateSkillMutation();
  const assignSkillMutation = useAssignSkillMutation();
  const unassignSkillMutation = useUnassignSkillMutation();
  const deleteSkillMutation = useDeleteSkillMutation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<RemoveAssignmentTarget | null>(null);
  const [mcpCreateOpen, setMcpCreateOpen] = useState(false);
  const [skillCreateOpen, setSkillCreateOpen] = useState(false);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editModel, setEditModel] = useState<string | null>(null);
  const [savedName, setSavedName] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const performSaveRef = useRef<() => Promise<boolean>>(async () => true);
  const editStateRef = useRef({
    editName,
    editPrompt,
    editModel,
    savedName,
    savedPrompt,
    savedModel,
    selectedId,
    detail,
  });
  editStateRef.current = {
    editName,
    editPrompt,
    editModel,
    savedName,
    savedPrompt,
    savedModel,
    selectedId,
    detail,
  };

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(modelsResponse?.models ?? []),
    [modelsResponse?.models],
  );

  const modelSelectionValue = useMemo(
    () => profileModelSelectionValue(editModel, providerModelGroups),
    [editModel, providerModelGroups],
  );

  const modelInCatalog = useMemo(() => {
    const resolvedModelId = extractModelId(editModel);

    if (!resolvedModelId) {
      return true;
    }

    return providerModelGroups.some((group) =>
      group.models.some((model) => model.id === resolvedModelId),
    );
  }, [editModel, providerModelGroups]);

  const busy =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    assignMutation.isPending ||
    unassignMutation.isPending ||
    assignMcpMutation.isPending ||
    unassignMcpMutation.isPending ||
    createMcpMutation.isPending ||
    createSkillMutation.isPending ||
    assignSkillMutation.isPending ||
    unassignSkillMutation.isPending ||
    deleteSkillMutation.isPending;

  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;
  const refreshing = profilesRefreshing || (detailLoading && Boolean(selectedId));
  const detailTab = resolveProfileDetailTab(searchParams.get("tab"));

  const isDirty = useMemo(() => {
    if (!detail) {
      return false;
    }

    return (
      editName.trim() !== savedName ||
      editPrompt !== savedPrompt ||
      editModel !== savedModel
    );
  }, [
    detail,
    editName,
    editPrompt,
    editModel,
    savedName,
    savedPrompt,
    savedModel,
  ]);

  const clearScheduledSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const scheduleSave = useCallback(
    (delayMs = profileTextSaveDelayMs) => {
      clearScheduledSave();

      const snapshot = editStateRef.current;
      const { selectedId: profileId, detail: profileDetail } = snapshot;

      if (!profileId || !profileDetail) {
        return;
      }

      if (!snapshot.editName.trim()) {
        setSaveStatus("idle");
        return;
      }

      if (!profileHasPendingEdits(snapshot)) {
        setSaveStatus("idle");
        return;
      }

      setSaveStatus("pending");
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void performSaveRef.current();
      }, delayMs);
    },
    [clearScheduledSave],
  );

  const performSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }

    const {
      editName: nameDraft,
      editPrompt: promptDraft,
      editModel: modelDraft,
      savedName: baselineName,
      savedPrompt: baselinePrompt,
      savedModel: baselineModel,
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

    if (
      name === baselineName &&
      promptDraft === baselinePrompt &&
      modelDraft === baselineModel
    ) {
      setSaveStatus("idle");
      return true;
    }

    savingRef.current = true;
    setSaveStatus("saving");
    setError(null);

    let savedSuccessfully = false;

    try {
      await updateMutation.mutateAsync({
        profileId,
        input: {
          name,
          systemPrompt: promptDraft,
          model: modelDraft,
        },
      });
      setSavedName(name);
      setSavedPrompt(promptDraft);
      setSavedModel(modelDraft);
      editStateRef.current = {
        ...editStateRef.current,
        savedName: name,
        savedPrompt: promptDraft,
        savedModel: modelDraft,
      };
      setSaveStatus("saved");
      savedSuccessfully = true;

      if (savedHintTimerRef.current) {
        clearTimeout(savedHintTimerRef.current);
      }

      savedHintTimerRef.current = setTimeout(() => {
        setSaveStatus((current) => (current === "saved" ? "idle" : current));
      }, 2000);

      return true;
    } catch (err) {
      setSaveStatus("error");
      setError(formatError(err));
      return false;
    } finally {
      savingRef.current = false;

      const queuedDuringSave = pendingSaveRef.current;
      pendingSaveRef.current = false;
      const hasMoreEdits = profileHasPendingEdits(editStateRef.current);

      if (savedSuccessfully && (queuedDuringSave || hasMoreEdits)) {
        scheduleSave(0);
      } else if (queuedDuringSave && hasMoreEdits) {
        scheduleSave(profileTextSaveDelayMs);
      }
    }
  }, [scheduleSave, updateMutation]);

  performSaveRef.current = performSave;

  const flushSave = useCallback(async (): Promise<boolean> => {
    clearScheduledSave();
    return performSave();
  }, [clearScheduledSave, performSave]);

  const handleEditNameChange = useCallback(
    (value: string) => {
      setEditName(value);
      editStateRef.current.editName = value;
      scheduleSave(profileTextSaveDelayMs);
    },
    [scheduleSave],
  );

  const handleEditPromptChange = useCallback(
    (value: string) => {
      setEditPrompt(value);
      editStateRef.current.editPrompt = value;
      scheduleSave(profileTextSaveDelayMs);
    },
    [scheduleSave],
  );

  const handleEditModelChange = useCallback(
    (model: string | null) => {
      setEditModel(model);
      editStateRef.current.editModel = model;
      scheduleSave(profileModelSaveDelayMs);
    },
    [scheduleSave],
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

  const setDetailTab = useCallback(
    (nextTab: ProfileDetailTab) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextTab === "profile") {
            next.delete("tab");
          } else {
            next.set("tab", nextTab);
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
      profiles.find((profile) => profile.id === "default") ??
      profiles[0]!;

    setSelectedId(defaultProfile.id);
  }, [profiles, searchParams, selectedId, setSelectedId]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    clearScheduledSave();
    pendingSaveRef.current = false;
    setEditName(detail.name);
    setEditPrompt(detail.systemPrompt);
    setEditModel(detail.model);
    setSavedName(detail.name);
    setSavedPrompt(detail.systemPrompt);
    setSavedModel(detail.model);
    editStateRef.current = {
      ...editStateRef.current,
      editName: detail.name,
      editPrompt: detail.systemPrompt,
      editModel: detail.model,
      savedName: detail.name,
      savedPrompt: detail.systemPrompt,
      savedModel: detail.model,
      detail,
    };
    setSaveStatus("idle");
  }, [clearScheduledSave, detail?.id]);

  useEffect(() => {
    return () => {
      clearScheduledSave();

      if (savedHintTimerRef.current) {
        clearTimeout(savedHintTimerRef.current);
      }
    };
  }, [clearScheduledSave]);

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

  const assignedSkillIds = useMemo(
    () => new Set(detail?.skills.map((skill) => skill.id) ?? []),
    [detail?.skills],
  );

  async function handleSelectProfile(profileId: string) {
    if (profileId === selectedId) {
      return;
    }

    clearScheduledSave();

    const {
      editName: nameDraft,
      editPrompt: promptDraft,
      editModel: modelDraft,
      savedName: baselineName,
      savedPrompt: baselinePrompt,
      savedModel: baselineModel,
    } = editStateRef.current;
    const hasPendingEdits =
      nameDraft.trim() !== baselineName ||
      promptDraft !== baselinePrompt ||
      modelDraft !== baselineModel;

    if (hasPendingEdits && nameDraft.trim()) {
      const saved = await performSave();
      if (!saved) {
        return;
      }
    }

    setSelectedId(profileId);
  }

  function openDeleteDialog(profileId: string) {
    setDeleteTargetId(profileId);
    setDeleteOpen(true);
  }

  function handleDeleteOpenChange(open: boolean) {
    if (busy) {
      return;
    }

    setDeleteOpen(open);

    if (!open) {
      setDeleteTargetId(null);
    }
  }

  async function handleDeleteConfirm() {
    const profileId = deleteTargetId;
    const profile = profileId ? profiles.find((entry) => entry.id === profileId) : null;

    if (!profileId || !profile || profile.isSuper) {
      return;
    }

    setError(null);

    try {
      await deleteMutation.mutateAsync(profileId);
      setDeleteOpen(false);
      setDeleteTargetId(null);

      if (selectedId === profileId) {
        setSelectedId(null);
      }
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAssignTool(toolId: string) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      await assignMutation.mutateAsync({ profileId: selectedId, toolId });
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

  async function handleCreateMcpServer(request: CreateMcpServerRequest) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      const response = await createMcpMutation.mutateAsync({ ...request, connect: true });
      await assignMcpMutation.mutateAsync({
        profileId: selectedId,
        serverId: response.server.id,
      });
      setMcpCreateOpen(false);
    } catch (err) {
      const message = formatError(err);
      setError(message);
      throw new Error(message);
    }
  }

  async function handleAssignSkill(skillId: string) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      await assignSkillMutation.mutateAsync({ profileId: selectedId, skillId });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleDeleteSkill(skillId: string) {
    const skill = allSkills.find((entry) => entry.id === skillId);

    if (!skill) {
      return;
    }

    if (!window.confirm(`Delete skill "${skill.name}"? This removes it from every profile.`)) {
      return;
    }

    setError(null);

    try {
      await deleteSkillMutation.mutateAsync(skillId);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleCreateSkill(request: CreateSkillRequest) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      const response = await createSkillMutation.mutateAsync(request);
      await assignSkillMutation.mutateAsync({
        profileId: selectedId,
        skillId: response.skill.id,
      });
      setSkillCreateOpen(false);
    } catch (err) {
      const message = formatError(err);
      setError(message);
      throw new Error(message);
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
      } else if (removeConfirm.kind === "mcp") {
        await unassignMcpMutation.mutateAsync({ profileId: selectedId, serverId: removeConfirm.id });
      } else {
        await unassignSkillMutation.mutateAsync({ profileId: selectedId, skillId: removeConfirm.id });
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

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
  }

  if (profilesLoading && profiles.length === 0) {
    return <PageState message="Loading profiles…" />;
  }

  const deleteTarget = deleteTargetId
    ? profiles.find((entry) => entry.id === deleteTargetId)
    : null;

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

              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => setCreateOpen(true)}
              >
                <PlusIcon className="size-4" aria-hidden />
                New
              </Button>

              {selectedId && detail && !detail.isSuper ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => openDeleteDialog(selectedId)}
                >
                  <Trash2Icon className="size-4" aria-hidden />
                  Delete
                </Button>
              ) : null}
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
                      onDelete={
                        profile.isSuper ? undefined : () => openDeleteDialog(profile.id)
                      }
                    />
                  ))}
                </div>
              )}

            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {profiles.length === 0 ? (
                <div className="p-4 sm:p-5">
                  <ProfilesEmptyState
                    variant="full"
                    disabled={busy}
                    onCreate={() => setCreateOpen(true)}
                  />
                </div>
              ) : detailLoading && !detail ? (
                <div className="p-4 sm:p-5">
                  <PageState message="Loading profile…" embedded />
                </div>
              ) : !selectedId || !detail ? (
                <div className="flex min-h-48 items-center justify-center p-4 text-sm text-muted-foreground sm:p-5">
                  Select a profile to edit.
                </div>
              ) : (
                <>
                  <div
                    role="tablist"
                    aria-label="Profile settings"
                    className="flex shrink-0 border-b border-border px-4 sm:px-5"
                  >
                    <ProfileDetailTabButton
                      id="profile-detail-tab-profile"
                      active={detailTab === "profile"}
                      controls="profile-detail-panel-profile"
                      onSelect={() => setDetailTab("profile")}
                    >
                      Config
                    </ProfileDetailTabButton>
                    <ProfileDetailTabButton
                      id="profile-detail-tab-prompt"
                      active={detailTab === "prompt"}
                      controls="profile-detail-panel-prompt"
                      onSelect={() => setDetailTab("prompt")}
                    >
                      Prompt
                    </ProfileDetailTabButton>
                    <ProfileDetailTabButton
                      id="profile-detail-tab-knowledge"
                      active={detailTab === "knowledge"}
                      controls="profile-detail-panel-knowledge"
                      onSelect={() => setDetailTab("knowledge")}
                    >
                      Knowledge
                    </ProfileDetailTabButton>
                    <ProfileDetailTabButton
                      id="profile-detail-tab-artifacts"
                      active={detailTab === "artifacts"}
                      controls="profile-detail-panel-artifacts"
                      onSelect={() => setDetailTab("artifacts")}
                    >
                      Artifacts
                    </ProfileDetailTabButton>
                  </div>

                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    {detailTab === "profile" ? (
                      <div
                        id="profile-detail-panel-profile"
                        role="tabpanel"
                        aria-labelledby="profile-detail-tab-profile"
                      >
                  <div className="mb-3">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      disabled={busy}
                      onChange={(event) => void handleAvatarSelected(event)}
                    />
                    <div className={cn(identityBoxClass, "flex min-w-0 items-start gap-4")}>
                      <EditableProfileAvatar
                        profile={detail}
                        size="lg"
                        disabled={busy || uploadAvatarMutation.isPending}
                        uploading={uploadAvatarMutation.isPending}
                        onPick={() => avatarInputRef.current?.click()}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="min-w-0">
                          <label htmlFor="profile-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                            Name
                          </label>
                          <Input
                            id="profile-name"
                            value={editName}
                            disabled={busy}
                            className="h-8 min-w-0 font-semibold"
                            onChange={(event) => handleEditNameChange(event.target.value)}
                            onBlur={() => void flushSave()}
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                            {detail.isSuper ? (
                              <span className="scope-badge bg-muted text-muted-foreground">super</span>
                            ) : null}
                            <ProfileSaveIndicator
                              inline
                              saveStatus={saveStatus}
                              nameMissing={isDirty && !editName.trim()}
                            />
                          </div>
                        </div>
                        <ExpandableTextarea
                          label="System prompt"
                          htmlFor="profile-prompt"
                          dialogDescription="Instructions sent to the model at the start of each chat."
                          value={editPrompt}
                          disabled={busy}
                          onChange={(event) => handleEditPromptChange(event.target.value)}
                          onSave={flushSave}
                          containerClassName="flex min-h-0 flex-1 flex-col gap-1.5"
                          previewClassName="min-h-16 flex-1"
                        />
                      </div>
                    </div>

                    <div className={cn(identityBoxClass, "flex min-w-0 flex-col gap-4")}>
                      <Field label="Model" htmlFor="profile-model">
                        <Select
                          value={modelSelectionValue}
                          disabled={busy || providerModelGroups.length === 0}
                          onValueChange={(value) => {
                            if (!value) {
                              return;
                            }

                            handleEditModelChange(String(value));
                          }}
                        >
                          <SelectTrigger id="profile-model" className="w-full">
                            <SelectValue placeholder="Select model">
                              {profileModelLabel(editModel, providerModelGroups)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className={modelSelectContentMaxHeightClass}>
                            {extractModelId(editModel) && !modelInCatalog ? (
                              <SelectItem
                                value={encodeModelSelection("__unknown__", extractModelId(editModel)!)}
                              >
                                {extractModelId(editModel)}
                              </SelectItem>
                            ) : null}
                            {providerModelGroups.flatMap((group) =>
                              group.models.map((model) => (
                                <SelectItem
                                  key={`${group.providerId}:${model.id}`}
                                  value={encodeModelSelection(group.providerId, model.id)}
                                >
                                  {group.providerLabel}: {model.name}
                                </SelectItem>
                              )),
                            )}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </div>
                  </div>

                    <div className="border-t border-border pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">Tools</h3>
                          <p className="type-body mt-1 text-xs">
                            {detail.tools.length === 0
                              ? "No tools assigned to this profile."
                              : `${detail.tools.length} assigned`}
                          </p>
                        </div>
                        <ToolAssignDialog
                          tools={availableTools}
                          disabled={busy}
                          onAssign={handleAssignTool}
                        />
                      </div>

                      {detail.tools.length === 0 ? (
                        <p className="type-body text-xs">No tools assigned.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.tools.map((tool) => (
                            <li
                              key={tool.id}
                              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium leading-tight text-foreground">
                                  {tool.name}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                                  {tool.description}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${tool.name}`}
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

                    <div className="pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">MCP servers</h3>
                          {detail.mcpServers.length > 0 ? (
                            <p className="type-body mt-1 text-xs">
                              {detail.mcpServers.length} assigned
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setMcpCreateOpen(true)}
                          >
                            <PlusIcon className="size-4" aria-hidden />
                            Add MCP server
                          </Button>
                          <McpServerAssignPicker
                            servers={availableMcpServers}
                            disabled={busy}
                            buttonLabel="Assign existing"
                            onAssign={handleAssignMcpServer}
                          />
                        </div>
                      </div>

                      {allMcpServers.length === 0 ? (
                        <p className="type-body text-xs text-muted-foreground">
                          Connect HTTP or command-based MCP servers.
                        </p>
                      ) : detail.mcpServers.length === 0 ? null : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.mcpServers.map((server) => (
                            <li
                              key={server.id}
                              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium leading-tight text-foreground">
                                  {server.name}
                                </p>
                                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
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
                                aria-label={`Delete ${server.name}`}
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

                    <div className="pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">Skills</h3>
                          {detail.skills.length > 0 ? (
                            <p className="type-body mt-1 text-xs">
                              {detail.skills.length} assigned
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setSkillCreateOpen(true)}
                          >
                            Add skill
                          </Button>
                          <SkillAssignPicker
                            skills={allSkills}
                            assignedSkillIds={assignedSkillIds}
                            disabled={busy}
                            buttonLabel="Manage skills"
                            onAssign={handleAssignSkill}
                            onDelete={handleDeleteSkill}
                          />
                        </div>
                      </div>

                      {allSkills.length === 0 ? (
                        <p className="type-body text-xs text-muted-foreground">
                          Create one above, or add{" "}
                          <code className="rounded bg-muted px-1 py-0.5">SKILL.md</code> folders to{" "}
                          <code className="rounded bg-muted px-1 py-0.5">agent/skills</code>.
                        </p>
                      ) : detail.skills.length === 0 ? null : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.skills.map((skill) => (
                            <li
                              key={skill.id}
                              className="group flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md hover:bg-muted/40"
                            >
                              <button
                                type="button"
                                disabled={busy}
                                className="flex min-w-0 flex-1 items-start text-left disabled:opacity-50"
                                aria-label={`View details for ${skill.name}`}
                                onClick={() => setDetailSkillId(skill.id)}
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium leading-tight text-foreground">
                                    {skill.name}
                                  </p>
                                  <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                                    {[
                                      skill.description,
                                      skill.hasTool ? "includes tool" : null,
                                      skill.disableModelInvocation ? "explicit invoke only" : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                </div>
                              </button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${skill.name}`}
                                onClick={() =>
                                  setRemoveConfirm({ kind: "skill", id: skill.id, name: skill.name })
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
                    ) : detailTab === "prompt" ? (
                      <div
                        id="profile-detail-panel-prompt"
                        role="tabpanel"
                        aria-labelledby="profile-detail-tab-prompt"
                      >
                        <SoulTab profileId={selectedId} />
                      </div>
                    ) : detailTab === "knowledge" ? (
                      <div
                        id="profile-detail-panel-knowledge"
                        role="tabpanel"
                        aria-labelledby="profile-detail-tab-knowledge"
                      >
                        <KnowledgeTab profileId={selectedId} />
                      </div>
                    ) : (
                      <div
                        id="profile-detail-panel-artifacts"
                        role="tabpanel"
                        aria-labelledby="profile-detail-tab-artifacts"
                      >
                        <ArtifactsTab profileId={selectedId} />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <ProfileCreateDialog
        open={createOpen}
        tools={allTools}
        onOpenChange={handleCreateOpenChange}
        onCreated={(profileId) => setSelectedId(profileId)}
      />

      <SkillCreateDialog
        open={skillCreateOpen}
        busy={createSkillMutation.isPending || assignSkillMutation.isPending}
        profileId={selectedId}
        onOpenChange={setSkillCreateOpen}
        onSubmit={handleCreateSkill}
      />

      <SkillDetailDialog
        skillId={detailSkillId}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSkillId(null);
          }
        }}
        onRemoveFromProfile={(skillId, skillName) => {
          setDetailSkillId(null);
          setRemoveConfirm({ kind: "skill", id: skillId, name: skillName });
        }}
      />

      <McpServerDialog
        open={mcpCreateOpen}
        busy={createMcpMutation.isPending || assignMcpMutation.isPending}
        onOpenChange={(open) => {
          setMcpCreateOpen(open);
        }}
        onSubmit={handleCreateMcpServer}
      />

      <Dialog open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete profile?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This removes ${deleteTarget.name} and its chat history. This cannot be undone.`
                : "This removes the profile and its chat history. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
            >
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
              {removeConfirm?.kind === "mcp"
                ? "Delete MCP server?"
                : removeConfirm?.kind === "skill"
                  ? "Delete skill?"
                  : "Delete tool?"}
            </DialogTitle>
            <DialogDescription>
              {removeConfirm?.kind === "mcp"
                ? `Delete "${removeConfirm.name}" from this profile? The server stays registered in Soul.`
                : removeConfirm?.kind === "skill"
                  ? `Delete "${removeConfirm.name}" from this profile? The skill stays available to assign again.`
                  : `Delete "${removeConfirm?.name}" from this profile?`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mx-0 -mb-2 gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
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
              {unassignMutation.isPending ||
              unassignMcpMutation.isPending ||
              unassignSkillMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

function ProfileDetailTabButton({
  id,
  active,
  controls,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  controls: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      data-active={active || undefined}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function ProfileSaveIndicator({
  saveStatus,
  nameMissing,
  inline = false,
}: {
  saveStatus: ProfileSaveStatus;
  nameMissing: boolean;
  inline?: boolean;
}) {
  let content: ReactNode = null;

  if (nameMissing) {
    content = (
      <span className="font-medium text-amber-700 dark:text-amber-300">Name is required</span>
    );
  } else if (saveStatus === "pending" || saveStatus === "saving") {
    content = (
      <span className="inline-flex items-center gap-1.5">
        <Spinner className="size-3" />
        Saving…
      </span>
    );
  } else if (saveStatus === "saved") {
    content = <span>Saved</span>;
  } else if (saveStatus === "error") {
    content = <span className="font-medium text-destructive">Save failed</span>;
  }

  if (!content) {
    return null;
  }

  if (inline) {
    return (
      <>
        <span aria-hidden>·</span>
        <span role="status">{content}</span>
      </>
    );
  }

  return <p className="mt-2 text-xs text-muted-foreground">{content}</p>;
}

function EditableProfileAvatar({
  profile,
  disabled,
  uploading,
  onPick,
  size = "md",
}: {
  profile: ProfileSummary;
  disabled: boolean;
  uploading: boolean;
  onPick: () => void;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const overlayIconClass = size === "lg" ? "size-5" : "size-4";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label="Change profile image"
      className="group relative shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ProfileAvatar profile={profile} size={size} />
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {uploading ? (
          <Spinner className={cn(overlayIconClass, "text-primary-foreground")} />
        ) : (
          <CameraIcon className={cn(overlayIconClass, "text-primary-foreground")} aria-hidden />
        )}
      </span>
    </button>
  );
}

function ProfileScopeButton({
  profile,
  active,
  disabled,
  onClick,
  onDelete,
}: {
  profile: ProfileSummary;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      data-active={active || undefined}
      className={cn(
        "scope-item group flex items-center gap-2",
        disabled && "opacity-50",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
      >
        <ProfileAvatar profile={profile} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
        </div>
      </button>
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          className="shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
          aria-label={`Delete ${profile.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2Icon className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
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
    title: "Customize soul & knowledge",
    description: "Set voice, identity, and documents per profile.",
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
