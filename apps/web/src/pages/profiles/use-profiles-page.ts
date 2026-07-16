import type {
  CreateMcpServerRequest,
  CreateSkillRequest,
} from "@nakama/core/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useComposioToolkits,
  useProfileComposioToolkits,
  useUpdateProfileComposioToolkitsMutation,
} from "@/hooks/use-composio";
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
import { fileToImageAttachment } from "@/lib/profile-images";
import { formatError } from "@/lib/client";
import {
  extractModelId,
  groupModelsByProvider,
  profileModelSelectionValue,
} from "@/lib/models";
import {
  profileHasPendingEdits,
  profileModelSaveDelayMs,
  profileTextSaveDelayMs,
  resolveProfileDetailTab,
  type ProfileDetailTab,
  type ProfileSaveStatus,
  type RemoveAssignmentTarget,
} from "@/pages/profiles/profiles-page.shared";

export function useProfilesPage() {

  const [searchParams, setSearchParams] = useSearchParams();
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
  const updateComposioMutation = useUpdateProfileComposioToolkitsMutation();
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
  const [syncedDetailId, setSyncedDetailId] = useState<string | null>(null);
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
    deleteSkillMutation.isPending ||
    updateComposioMutation.isPending;

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
      if (selectedIdRef.current !== null) {
        setSelectedId(null);
      }
      return;
    }

    const urlProfileId = searchParams.get("profile");

    if (!profileInitializedRef.current) {
      profileInitializedRef.current = true;
      const matchedProfile = urlProfileId
        ? profiles.find((profile) => profile.id === urlProfileId)
        : null;
      const defaultProfile =
        matchedProfile ??
        profiles.find((profile) => profile.id === "default") ??
        profiles[0]!;

      setSelectedId(defaultProfile.id);
      return;
    }

    if (
      urlProfileId &&
      profiles.some((profile) => profile.id === urlProfileId) &&
      urlProfileId !== selectedIdRef.current
    ) {
      setSelectedId(urlProfileId);
      return;
    }

    const current = selectedIdRef.current;
    if (current && !profiles.some((profile) => profile.id === current)) {
      setSelectedId(profiles[0]!.id);
    }
  }, [profiles, searchParams, setSelectedId]);

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

  const assignedComposioToolkits = useMemo(() => {
    if (!profileComposioData || !composioToolkitsData) {
      return [];
    }

    const toolkitById = new Map(
      composioToolkitsData.orgToolkits.map((toolkit) => [toolkit.id, toolkit]),
    );

    const userByToolkitId = new Map(
      composioToolkitsData.userConnections.map((connection) => [connection.toolkitId, connection]),
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
      profileComposioData?.assignments.map((assignment) => assignment.toolkitId) ?? [],
    );

    return composioToolkitsData.orgToolkits.filter(
      (toolkit) => toolkit.status !== "disabled" && !assignedIds.has(toolkit.id),
    );
  }, [composioToolkitsData, profileComposioData]);

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

  async function handleAssignComposioToolkit(toolkitId: string) {
    if (!selectedId || !profileComposioData) {
      return;
    }

    setError(null);

    try {
      await updateComposioMutation.mutateAsync({
        profileId: selectedId,
        assignments: [
          ...profileComposioData.assignments.map((assignment) => ({
            toolkitId: assignment.toolkitId,
            allowedActions: assignment.allowedActions,
          })),
          { toolkitId },
        ],
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
      } else if (removeConfirm.kind === "mcp") {
        await unassignMcpMutation.mutateAsync({ profileId: selectedId, serverId: removeConfirm.id });
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
            toolkitId: assignment.toolkitId,
            allowedActions: assignment.allowedActions,
          });
        }

        await updateComposioMutation.mutateAsync({
          profileId: selectedId,
          assignments,
        });
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

  const deleteTarget = deleteTargetId
    ? profiles.find((entry) => entry.id === deleteTargetId)
    : null;


  return {
    profiles,
    profilesLoading,
    profilesRefreshing,
    allTools,
    allMcpServers,
    composioToolkitsData,
    selectedId,
    profileComposioData,
    allSkills,
    modelsResponse,
    detail,
    detailLoading,
    detailError,
    refetchDetail,
    busy,
    error,
    createOpen,
    setCreateOpen,
    deleteOpen,
    setDeleteOpen,
    deleteTargetId,
    deleteTarget,
    removeConfirm,
    setRemoveConfirm,
    mcpCreateOpen,
    setMcpCreateOpen,
    skillCreateOpen,
    setSkillCreateOpen,
    detailSkillId,
    setDetailSkillId,
    searchQuery,
    setSearchQuery,
    editName,
    editPrompt,
    editModel,
    saveStatus,
    isDirty,
    trimmedSearch,
    isSearching,
    refreshing,
    detailTab,
    providerModelGroups,
    modelSelectionValue,
    modelInCatalog,
    filteredProfiles,
    availableTools,
    availableMcpServers,
    assignedComposioToolkits,
    availableComposioToolkits,
    assignedSkillIds,
    avatarInputRef,
    uploadAvatarMutation,
    createSkillMutation,
    assignSkillMutation,
    createMcpMutation,
    assignMcpMutation,
    deleteMutation,
    unassignMutation,
    unassignMcpMutation,
    unassignSkillMutation,
    handleSelectProfile,
    openDeleteDialog,
    handleDeleteOpenChange,
    handleDeleteConfirm,
    handleAssignTool,
    handleAssignMcpServer,
    handleCreateMcpServer,
    handleAssignSkill,
    handleDeleteSkill,
    handleCreateSkill,
    handleAssignComposioToolkit,
    handleRemoveAssignmentConfirm,
    handleAvatarSelected,
    handleCreateOpenChange,
    handleEditNameChange,
    handleEditPromptChange,
    handleEditModelChange,
    flushSave,
    setDetailTab,
    setSelectedId,
  };
}

export type ProfilesPageState = ReturnType<typeof useProfilesPage>;
