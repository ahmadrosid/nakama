import { Trash2Icon } from "lucide-react";
import { ArtifactsTab } from "@/components/soul-tools/ArtifactsTab";
import { KnowledgeTab } from "@/components/soul-tools/KnowledgeTab";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProfileAdminPlusButton } from "@/components/ProfileAdminPlusButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { sectionClass, profilePanelHeaderClass, profilePanelHeaderLabelClass } from "@/pages/profiles/profiles-page.shared";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";
import {
  PageState,
  ProfileDetailTabButton,
  ProfileScopeButton,
  ProfilesEmptyState,
} from "@/pages/profiles/profiles-ui";

export function ProfilesPageLayout(state: ProfilesPageState) {
  const {
    profiles,
    profilesLoading,
    busy,
    error,
    selectedId,
    detail,
    detailLoading,
    refetchDetail,
    refreshing,
    detailTab,
    setDetailTab,
    handleSelectProfile,
    setCreateOpen,
    openDeleteDialog,
  } = state;
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canCreateProfile = user?.isPlatformAdmin === true;
  const { navigateToNewChat } = useAppNavigation();
  const superBotProfileId = resolveSuperBotChatProfileId(profiles);
  const { data: skillProposalsData } = useSkillProposals(
    isOrgAdmin && selectedId ? (activeOrg?.id ?? null) : null,
    { status: "pending", profileId: selectedId ?? undefined },
  );
  const pendingSkillProposals = skillProposalsData?.pendingCount ?? 0;
  const onAskSuperBot = superBotProfileId
    ? () => navigateToNewChat(superBotProfileId)
    : undefined;

  if (profilesLoading && profiles.length === 0) {
    return <PageState message="Loading profiles…" />;
  }

  return (
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

        <section className={cn(sectionClass, "flex min-h-[calc(100svh-7rem)] flex-col overflow-hidden")}>
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:hidden">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={selectedId ?? ""}
                disabled={busy || refreshing || profiles.length === 0}
                onValueChange={(value) => {
                  if (value) {
                    handleSelectProfile(String(value));
                  }
                }}
              >
                <SelectTrigger className="min-w-0 flex-1" aria-label="Selected profile">
                  <SelectValue placeholder="Select profile">
                    {profiles.find((profile) => profile.id === selectedId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      <span className="flex items-center gap-2">
                        <ProfileAvatar profile={profile} size="sm" />
                        <span>{profile.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {canCreateProfile ? (
                <ProfileAdminPlusButton
                  label="New profile"
                  disabled={busy}
                  onClick={() => setCreateOpen(true)}
                />
              ) : null}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <aside className="hidden shrink-0 flex-col border-b border-border lg:flex lg:w-56 lg:border-r lg:border-b-0">
              <div className={profilePanelHeaderClass}>
                <span className={profilePanelHeaderLabelClass}>Profiles</span>
              {canCreateProfile ? (
                <ProfileAdminPlusButton
                  label="New profile"
                  disabled={busy}
                  tooltipSide="top"
                  onClick={() => setCreateOpen(true)}
                />
              ) : null}
            </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {profiles.length === 0 ? (
                  <ProfilesEmptyState
                    variant="compact"
                    disabled={busy}
                    canCreate={canCreateProfile}
                    onCreate={() => setCreateOpen(true)}
                    onAskSuperBot={onAskSuperBot}
                  />
                ) : (
                  <nav aria-label="Profiles" className="flex flex-col gap-1">
                    {profiles.map((profile) => (
                      <ProfileScopeButton
                        key={profile.id}
                        profile={profile}
                        active={selectedId === profile.id}
                        disabled={busy}
                        onClick={() => handleSelectProfile(profile.id)}
                      />
                    ))}
                  </nav>
                )}
              </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {profiles.length === 0 ? (
                <div className="p-4 sm:p-5">
                  <ProfilesEmptyState
                    variant="full"
                    disabled={busy}
                    canCreate={canCreateProfile}
                    onCreate={() => setCreateOpen(true)}
                    onAskSuperBot={onAskSuperBot}
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
                  <div className="flex min-w-0 shrink-0 items-stretch border-b border-border">
                    <div
                      role="tablist"
                      aria-label="Profile settings"
                      className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto px-2 sm:px-3"
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
                      {isOrgAdmin ? (
                        <ProfileDetailTabButton
                          id="profile-detail-tab-proposals"
                          active={detailTab === "proposals"}
                          controls="profile-detail-panel-proposals"
                          onSelect={() => setDetailTab("proposals")}
                        >
                          Proposals
                          {pendingSkillProposals > 0 ? (
                            <span className="tabular-nums text-xs text-amber-600 dark:text-amber-400">
                              ({pendingSkillProposals > 99 ? "99+" : pendingSkillProposals})
                            </span>
                          ) : null}
                        </ProfileDetailTabButton>
                      ) : null}
                    </div>
                    {!detail.isSuper ? (
                      <div className="flex shrink-0 items-center border-l border-border px-2 sm:px-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label="Delete profile"
                          className="text-destructive hover:text-destructive max-sm:size-7 max-sm:px-0"
                          onClick={() => openDeleteDialog(selectedId)}
                        >
                          <Trash2Icon className="size-3.5" aria-hidden />
                          <span className="hidden sm:inline">Delete</span>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {detailTab === "profile" ? (
                    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                      <ProfileConfigTab state={state} />
                    </div>
                  ) : detailTab === "proposals" && isOrgAdmin && activeOrg && selectedId ? (
                    <div
                      id="profile-detail-panel-proposals"
                      role="tabpanel"
                      aria-labelledby="profile-detail-tab-proposals"
                      className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
                    >
                      <SkillProposalsPanel orgId={activeOrg.id} profileId={selectedId} />
                    </div>
                  ) : detailTab === "prompt" ? (
                    <div
                      id="profile-detail-panel-prompt"
                      role="tabpanel"
                      aria-labelledby="profile-detail-tab-prompt"
                      className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
                    >
                      <SoulTab profileId={selectedId} />
                    </div>
                  ) : detailTab === "knowledge" ? (
                    <div
                      id="profile-detail-panel-knowledge"
                      role="tabpanel"
                      aria-labelledby="profile-detail-tab-knowledge"
                      className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
                    >
                      <KnowledgeTab profileId={selectedId} />
                    </div>
                  ) : (
                    <ChatAttachmentPanelProvider presentation="overlay">
                      <div
                        id="profile-detail-panel-artifacts"
                        role="tabpanel"
                        aria-labelledby="profile-detail-tab-artifacts"
                        className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-5"
                      >
                        <ArtifactsTab profileId={selectedId} />
                      </div>
                    </ChatAttachmentPanelProvider>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
  );
}
