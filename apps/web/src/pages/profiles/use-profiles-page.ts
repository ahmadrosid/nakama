import type {
  CreateMcpServerRequest,
  CreateSkillRequest,
  InstallSkillRequest,
} from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import {
  useMcpServersQuery,
  useModelsQuery,
  useProfileQuery,
  useProfilesQuery,
  useSkillsQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  useComposioToolkits,
  useProfileComposioToolkits,
  useUpdateProfileComposioToolkitsMutation,
} from "@/hooks/use-composio";
import {
  useAssignMcpServerMutation,
  useAssignSkillMutation,
  useAssignToolMutation,
  useCloneProfileMutation,
  useCreateMcpServerMutation,
  useCreateSkillMutation,
  useDeleteProfileAvatarMutation,
  useDeleteProfileMutation,
  useDeleteSkillMutation,
  useInstallSkillMutation,
  useUnassignMcpServerMutation,
  useUnassignSkillMutation,
  useUnassignToolMutation,
  useUpdateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { resolveProfilesPageProfileId } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import {
  extractModelId,
  groupModelsByProvider,
  profileModelSelectionValue,
} from "@/lib/models";
import { fileToImageAttachment } from "@/lib/profile-images";
import {
  type ProfileDetailTab,
  type ProfileSaveStatus,
  profileHasPendingEdits,
  profileModelSaveDelayMs,
  profileTextSaveDelayMs,
  type RemoveAssignmentTarget,
  resolveProfileDetailTab,
} from "@/pages/profiles/profiles-page.shared";

export function useProfilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profileId: liveChatProfileId } = useActiveChatProfile();
  const {
    data: profiles = [],
    isLoading: profilesLoading,
    isFetching: profilesRefreshing,
    error: profilesError,
  } = useProfilesQuery();
  const { data: allTools = [] } = useToolsQuery();
  const { data: allMcpServers = [] } = useMcpServersQuery();
  const { data: composioToolkitsData } = useComposioToolkits();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const profileInitializedRef = useRef(false);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const { data: profileComposioData } = useProfileComposioToolkits(selectedId);
  const { data: allSkills = [] } = useSkillsQuery();
  const { data: modelsResponse } = useModelsQuery();
  const {
    data: detail = null,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useProfileQuery(selectedId);
  const updateMutation = useUpdateProfileMutation();
  const cloneProfileMutation = useCloneProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const deleteAvatarMutation = useDeleteProfileAvatarMutation();
  const assignMutation = useAssignToolMutation();
  const unassignMutation = useUnassignToolMutation();
  const assignMcpMutation = useAssignMcpServerMutation();
  const unassignMcpMutation = useUnassignMcpServerMutation();
  const createMcpMutation = useCreateMcpServerMutation();
  const createSkillMutation = useCreateSkillMutation();
  const installSkillMutation = useInstallSkillMutation();
  const assignSkillMutation = useAssignSkillMutation();
  const unassignSkillMutation = useUnassignSkillMutation();
  const deleteSkillMutation = useDeleteSkillMutation();
  const updateComposioMutation = useUpdateProfileComposioToolkitsMutation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] =
    useState<RemoveAssignmentTarget | null>(null);
  const [mcpCreateOpen, setMcpCreateOpen] = useState(false);
  const [skillCreateOpen, setSkillCreateOpen] = useState(false);
  const [skillInstallOpen, setSkillInstallOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editModel, setEditModel] = useState<string | null>(null);
  const [savedName, setSavedName] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>("idle");
  const [syncedDetailId, setSyncedDetailId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const performSaveRef = useRef<() => Promise<boolean>>(async () => true);
  const editStateRef = useRef({
    detail,
    editModel,
    editName,
    editPrompt,
    savedModel,
    savedName,
    savedPrompt,
    selectedId,
  });

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(modelsResponse?.models ?? []),
    [modelsResponse?.models]
  );

  const modelSelectionValue = useMemo(
    () => profileModelSelectionValue(editModel, providerModelGroups),
    [editModel, providerModelGroups]
  );

  const modelInCatalog = useMemo(() => {
    const resolvedModelId = extractModelId(editModel);

    if (!resolvedModelId) {
      return true;
    }

    return providerModelGroups.some((group) =>
      group.models.some((model) => model.id === resolvedModelId)
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
    installSkillMutation.isPending ||
    assignSkillMutation.isPending ||
    unassignSkillMutation.isPending ||
    deleteSkillMutation.isPending ||
    updateComposioMutation.isPending;

  const refreshing =
    profilesRefreshing || (detailLoading && Boolean(selectedId));
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

      if (!(profileId && profileDetail)) {
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
    [clearScheduledSave]
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

    if (!(profileId && profileDetail)) {
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
        input: {
          model: modelDraft,
          name,
          systemPrompt: promptDraft,
        },
        profileId,
      });
      setSavedName(name);
      setSavedPrompt(promptDraft);
      setSavedModel(modelDraft);
      editStateRef.current = {
        ...editStateRef.current,
        savedModel: modelDraft,
        savedName: name,
        savedPrompt: promptDraft,
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

  useEffect(() => {
    editStateRef.current = {
      detail,
      editModel,
      editName,
      editPrompt,
      savedModel,
      savedName,
      savedPrompt,
      selectedId,
    };
  }, [
    detail,
    editModel,
    editName,
    editPrompt,
    savedModel,
    savedName,
    savedPrompt,
    selectedId,
  ]);

  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

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
    [scheduleSave]
  );

  const handleEditPromptChange = useCallback(
    (value: string) => {
      setEditPrompt(value);
      editStateRef.current.editPrompt = value;
      scheduleSave(profileTextSaveDelayMs);
    },
    [scheduleSave]
  );

  const handleEditModelChange = useCallback(
    (model: string | null) => {
      setEditModel(model);
      editStateRef.current.editModel = model;
      scheduleSave(profileModelSaveDelayMs);
    },
    [scheduleSave]
  );

  const switchingProfileRef = useRef(false);
  const handleSelectProfileRef = useRef<(profileId: string) => Promise<void>>(
    async () => undefined
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
        { replace: true }
      );
    },
    [setSearchParams]
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
        { replace: true }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    const queryError = profilesError ?? detailError;
    if (queryError) {
      setError(formatError(queryError));
    }
  }, [profilesError, detailError]);

  useEffect(() => {
    if (profiles.length === 0) {
      if (selectedIdRef.current !== null) {
        setSelectedId(null);
      }
      return;
    }

    const urlProfileId = searchParams.get("profile");

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      const initialProfileId = resolveProfilesPageProfileId({
        liveChatProfileId,
        profiles,
        search: searchParams.toString(),
      });

      if (initialProfileId) {
        setSelectedId(initialProfileId);
      }
      return;
    }

    if (
      urlProfileId &&
      profiles.some((profile) => profile.id === urlProfileId) &&
      urlProfileId !== selectedIdRef.current
    ) {
      void handleSelectProfileRef.current(urlProfileId);
      return;
    }

    const current = selectedIdRef.current;
    if (current && !profiles.some((profile) => profile.id === current)) {
      setSelectedId(profiles[0]!.id);
    }
  }, [liveChatProfileId, profiles, searchParams, setSelectedId]);

  const detailId = detail?.id ?? null;

  if (detailId !== syncedDetailId) {
    setSyncedDetailId(detailId);

    if (detail) {
      setEditName(detail.name);
      setEditPrompt(detail.systemPrompt);
      setEditModel(detail.model);
      setSavedName(detail.name);
      setSavedPrompt(detail.systemPrompt);
      setSavedModel(detail.model);
      setSaveStatus("idle");
    }
  }

  useEffect(() => {
    if (!detailId) {
      return;
    }

    clearScheduledSave();
    pendingSaveRef.current = false;
  }, [clearScheduledSave, detailId]);

  useEffect(
    () => () => {
      clearScheduledSave();

      if (savedHintTimerRef.current) {
        clearTimeout(savedHintTimerRef.current);
      }
    },
    [clearScheduledSave]
  );

  const availableTools = allTools.filter(
    (tool) => !detail?.tools.some((assigned) => assigned.id === tool.id)
  );

  const availableMcpServers = allMcpServers.filter(
    (server) =>
      !detail?.mcpServers.some((assigned) => assigned.id === server.id)
  );

  const assignedComposioToolkits = useMemo(() => {
    if (!(profileComposioData && composioToolkitsData)) {
      return [];
    }

    const toolkitById = new Map(
      composioToolkitsData.orgToolkits.map((toolkit) => [toolkit.id, toolkit])
    );

    const userByToolkitId = new Map(
      composioToolkitsData.userConnections.map((connection) => [
        connection.toolkitId,
        connection,
      ])
    );

    const assigned: Array<{
      assignment: (typeof profileComposioData.assignments)[number];
      toolkit: NonNullable<ReturnType<typeof toolkitById.get>>;
      userConnection: ReturnType<typeof userByToolkitId.get>;
    }> = [];

    for (const assignment of profileComposioData.assignments) {
      const toolkit = toolkitById.get(assignment.toolkitId);
      if (!toolkit) {
        continue;
      }

      assigned.push({
        assignment,
        toolkit,
        userConnection: userByToolkitId.get(assignment.toolkitId),
      });
    }

    return assigned;
  }, [composioToolkitsData, profileComposioData]);

  const availableComposioToolkits = useMemo(() => {
    if (!composioToolkitsData) {
      return [];
    }

    const assignedIds = new Set(
      profileComposioData?.assignments.map(
        (assignment) => assignment.toolkitId
      ) ?? []
    );

    return composioToolkitsData.orgToolkits.filter(
      (toolkit) => toolkit.status !== "disabled" && !assignedIds.has(toolkit.id)
    );
  }, [composioToolkitsData, profileComposioData]);

  const assignedSkillIds = useMemo(
    () => new Set(detail?.skills.map((skill) => skill.id) ?? []),
    [detail?.skills]
  );

  const handleSelectProfile = useCallback(
    async (profileId: string) => {
      if (profileId === selectedIdRef.current || switchingProfileRef.current) {
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

      switchingProfileRef.current = true;

      try {
        if (hasPendingEdits && nameDraft.trim()) {
          const saved = await performSave();
          if (!saved) {
            const current = selectedIdRef.current;
            if (current) {
              setSelectedId(current);
            }
            return;
          }
        }

        setSelectedId(profileId);
      } finally {
        switchingProfileRef.current = false;
      }
    },
    [clearScheduledSave, performSave, setSelectedId]
  );

  useEffect(() => {
    handleSelectProfileRef.current = handleSelectProfile;
  }, [handleSelectProfile]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    setCreateOpen(true);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("create");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

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

  async function handleCloneProfile(profileId: string) {
    setError(null);

    try {
      const response = await cloneProfileMutation.mutateAsync(profileId);
      setSelectedId(response.profile.id);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleDeleteConfirm() {
    const profileId = deleteTargetId;
    const profile = profileId
      ? profiles.find((entry) => entry.id === profileId)
      : null;

    if (!(profileId && profile) || profile.isSuper) {
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
      setMcpCreateOpen(false);
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
      const response = await createMcpMutation.mutateAsync({
        ...request,
        connect: true,
      });
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

    // Confirmation lives in SkillAssignPicker — window.confirm cannot run while that Dialog is open.
    setError(null);

    try {
      await deleteSkillMutation.mutateAsync(skillId);
    } catch (err) {
      setError(formatError(err));
      throw err;
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

  async function handleInstallSkill(request: InstallSkillRequest) {
    if (!selectedId) {
      return;
    }

    setError(null);

    try {
      await installSkillMutation.mutateAsync(request);
      setSkillInstallOpen(false);
    } catch (err) {
      const message = formatError(err);
      setError(message);
      throw new Error(message);
    }
  }

  async function handleAssignComposioToolkit(toolkitId: string) {
    if (!(selectedId && profileComposioData)) {
      return;
    }

    setError(null);

    try {
      await updateComposioMutation.mutateAsync({
        assignments: [
          ...profileComposioData.assignments.map((assignment) => ({
            allowedActions: assignment.allowedActions,
            toolkitId: assignment.toolkitId,
          })),
          { toolkitId },
        ],
        profileId: selectedId,
      });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleRemoveAssignmentConfirm() {
    if (!(selectedId && removeConfirm)) {
      return;
    }

    setError(null);

    try {
      if (removeConfirm.kind === "tool") {
        await unassignMutation.mutateAsync({
          profileId: selectedId,
          toolId: removeConfirm.id,
        });
      } else if (removeConfirm.kind === "mcp") {
        await unassignMcpMutation.mutateAsync({
          profileId: selectedId,
          serverId: removeConfirm.id,
        });
      } else if (removeConfirm.kind === "composio") {
        if (!profileComposioData) {
          return;
        }

        const assignments = [];

        for (const assignment of profileComposioData.assignments) {
          if (assignment.toolkitId === removeConfirm.id) {
            continue;
          }

          assignments.push({
            allowedActions: assignment.allowedActions,
            toolkitId: assignment.toolkitId,
          });
        }

        await updateComposioMutation.mutateAsync({
          assignments,
          profileId: selectedId,
        });
      } else {
        await unassignSkillMutation.mutateAsync({
          profileId: selectedId,
          skillId: removeConfirm.id,
        });
      }

      setRemoveConfirm(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAvatarSelected(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!(selectedId && file)) {
      return;
    }

    setError(null);

    try {
      const attachment = await fileToImageAttachment(file);

      if (!attachment) {
        setError("Could not read the selected image.");
        return;
      }

      await uploadAvatarMutation.mutateAsync({
        attachment,
        profileId: selectedId,
      });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAvatarRemove() {
    if (!selectedId) {
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
  }

  const deleteTarget = deleteTargetId
    ? profiles.find((entry) => entry.id === deleteTargetId)
    : null;

  return {
    allMcpServers,
    allSkills,
    allTools,
    assignedComposioToolkits,
    assignedSkillIds,
    assignMcpMutation,
    assignSkillMutation,
    availableComposioToolkits,
    availableMcpServers,
    availableTools,
    avatarInputRef,
    busy,
    cloneProfileMutation,
    composioToolkitsData,
    createMcpMutation,
    createOpen,
    createSkillMutation,
    deleteAvatarMutation,
    deleteMutation,
    deleteOpen,
    deleteTarget,
    deleteTargetId,
    detail,
    detailError,
    detailLoading,
    detailTab,
    editModel,
    editName,
    editPrompt,
    error,
    flushSave,
    handleAssignComposioToolkit,
    handleAssignMcpServer,
    handleAssignSkill,
    handleAssignTool,
    handleAvatarRemove,
    handleAvatarSelected,
    handleCloneProfile,
    handleCreateMcpServer,
    handleCreateOpenChange,
    handleCreateSkill,
    handleDeleteConfirm,
    handleDeleteOpenChange,
    handleDeleteSkill,
    handleEditModelChange,
    handleEditNameChange,
    handleEditPromptChange,
    handleInstallSkill,
    handleRemoveAssignmentConfirm,
    installSkillMutation,
    isDirty,
    mcpCreateOpen,
    modelInCatalog,
    modelSelectionValue,
    modelsResponse,
    openDeleteDialog,
    profileComposioData,
    profiles,
    profilesLoading,
    profilesRefreshing,
    providerModelGroups,
    refetchDetail,
    refreshing,
    removeConfirm,
    saveStatus,
    selectedId,
    setCreateOpen,
    setDeleteOpen,
    setDetailTab,
    setMcpCreateOpen,
    setRemoveConfirm,
    setSelectedId,
    setSkillCreateOpen,
    setSkillInstallOpen,
    skillCreateOpen,
    skillInstallOpen,
    unassignMcpMutation,
    unassignMutation,
    unassignSkillMutation,
    uploadAvatarMutation,
  };
}

export type ProfilesPageState = ReturnType<typeof useProfilesPage>;
