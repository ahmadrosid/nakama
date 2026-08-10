import { Delete02Icon } from "hugeicons-react";
import { ProfileAdminPlusButton } from "@/components/ProfileAdminPlusButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import {
  profilePanelHeaderClass,
  profilePanelHeaderLabelClass,
  sectionClass,
} from "@/pages/profiles/profiles-page.shared";
import {
  PageState,
  ProfileDetailTabButton,
  ProfileScopeButton,
  ProfilesEmptyState,
} from "@/pages/profiles/profiles-ui";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

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
    { profileId: selectedId ?? undefined, status: "pending" }
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
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {error}
          {selectedId ? (
            <>
              {" "}
              <button
                className="underline underline-offset-2"
                onClick={() => void refetchDetail()}
                type="button"
              >
                Retry
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <section
        className={cn(
          sectionClass,
          "flex min-h-[calc(100svh-7rem)] flex-col overflow-hidden"
        )}
      >
        <div className="flex flex-col gap-3 border-border border-b p-4 lg:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              disabled={busy || refreshing || profiles.length === 0}
              onValueChange={(value) => {
                if (value) {
                  handleSelectProfile(String(value));
                }
              }}
              value={selectedId ?? ""}
            >
              <SelectTrigger
                aria-label="Selected profile"
                className="min-w-0 flex-1"
              >
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
                disabled={busy}
                label="New profile"
                onClick={() => setCreateOpen(true)}
              />
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="hidden shrink-0 flex-col border-border border-b lg:flex lg:w-56 lg:border-r lg:border-b-0">
            <div className={profilePanelHeaderClass}>
              <span className={profilePanelHeaderLabelClass}>Profiles</span>
              {canCreateProfile ? (
                <ProfileAdminPlusButton
                  disabled={busy}
                  label="New profile"
                  onClick={() => setCreateOpen(true)}
                  tooltipSide="top"
                />
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {profiles.length === 0 ? (
                <ProfilesEmptyState
                  canCreate={canCreateProfile}
                  disabled={busy}
                  onAskSuperBot={onAskSuperBot}
                  onCreate={() => setCreateOpen(true)}
                  variant="compact"
                />
              ) : (
                <nav aria-label="Profiles" className="flex flex-col gap-1">
                  {profiles.map((profile) => (
                    <ProfileScopeButton
                      active={selectedId === profile.id}
                      disabled={busy}
                      key={profile.id}
                      onClick={() => handleSelectProfile(profile.id)}
                      profile={profile}
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
                  canCreate={canCreateProfile}
                  disabled={busy}
                  onAskSuperBot={onAskSuperBot}
                  onCreate={() => setCreateOpen(true)}
                  variant="full"
                />
              </div>
            ) : detailLoading && !detail ? (
              <div className="p-4 sm:p-5">
                <PageState embedded message="Loading profile…" />
              </div>
            ) : selectedId && detail ? (
              <>
                <div className="flex min-w-0 shrink-0 items-stretch border-border border-b">
                  <div
                    aria-label="Profile settings"
                    className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto px-2 sm:px-3"
                    role="tablist"
                  >
                    <ProfileDetailTabButton
                      active={detailTab === "profile"}
                      controls="profile-detail-panel-profile"
                      id="profile-detail-tab-profile"
                      onSelect={() => setDetailTab("profile")}
                    >
                      Config
                    </ProfileDetailTabButton>
                    <ProfileDetailTabButton
                      active={detailTab === "prompt"}
                      controls="profile-detail-panel-prompt"
                      id="profile-detail-tab-prompt"
                      onSelect={() => setDetailTab("prompt")}
                    >
                      Prompt
                    </ProfileDetailTabButton>
                    {isOrgAdmin ? (
                      <ProfileDetailTabButton
                        active={detailTab === "proposals"}
                        controls="profile-detail-panel-proposals"
                        id="profile-detail-tab-proposals"
                        onSelect={() => setDetailTab("proposals")}
                      >
                        Proposals
                        {pendingSkillProposals > 0 ? (
                          <span className="text-amber-600 text-xs tabular-nums dark:text-amber-400">
                            (
                            {pendingSkillProposals > 99
                              ? "99+"
                              : pendingSkillProposals}
                            )
                          </span>
                        ) : null}
                      </ProfileDetailTabButton>
                    ) : null}
                  </div>
                  {detail.isSuper ? null : (
                    <div className="flex shrink-0 items-center border-border border-l px-2 sm:px-3">
                      <Button
                        aria-label="Delete profile"
                        className="text-destructive hover:text-destructive max-sm:size-7 max-sm:px-0"
                        disabled={busy}
                        onClick={() => openDeleteDialog(selectedId)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Delete02Icon aria-hidden className="size-3.5" />
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                  )}
                </div>
                {detailTab === "profile" ? (
                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    <ProfileConfigTab state={state} />
                  </div>
                ) : detailTab === "proposals" &&
                  isOrgAdmin &&
                  activeOrg &&
                  selectedId ? (
                  <div
                    aria-labelledby="profile-detail-tab-proposals"
                    className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
                    id="profile-detail-panel-proposals"
                    role="tabpanel"
                  >
                    <SkillProposalsPanel
                      orgId={activeOrg.id}
                      profileId={selectedId}
                    />
                  </div>
                ) : detailTab === "prompt" ? (
                  <div
                    aria-labelledby="profile-detail-tab-prompt"
                    className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
                    id="profile-detail-panel-prompt"
                    role="tabpanel"
                  >
                    <SoulTab profileId={selectedId} />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex min-h-48 items-center justify-center p-4 text-muted-foreground text-sm sm:p-5">
                Select a profile to edit.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
