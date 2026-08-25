import { Copy01Icon, Delete02Icon, Upload04Icon } from "hugeicons-react";
import { createPortal } from "react-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ExportProfileButton } from "@/components/profiles/ExportProfileButton";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import { sectionClass } from "@/pages/profiles/profiles-page.shared";
import {
  PageState,
  ProfileDetailTabButton,
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
    detailTab,
    setDetailTab,
    setCreateOpen,
    setImportOpen,
    handleCloneProfile,
    openDeleteDialog,
  } = state;
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canCreateProfile = user?.isPlatformAdmin === true;
  const canPack = isOrgAdmin || canCreateProfile;
  const selectedProfileSummary = selectedId
    ? (profiles.find((profile) => profile.id === selectedId) ?? null)
    : null;
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
  const pageHeaderActions =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>("[data-page-header-actions]");

  if (profilesLoading && profiles.length === 0) {
    return <PageState message="Loading profiles…" />;
  }

  return (
    <div className="space-y-4">
      {pageHeaderActions && selectedId && detail
        ? createPortal(
            <div
              aria-label="Profile settings"
              className="no-scrollbar flex h-full min-w-0 items-stretch overflow-x-auto"
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
              {canCreateProfile ? (
                <ProfileDetailTabButton
                  active={detailTab === "prompt"}
                  controls="profile-detail-panel-prompt"
                  id="profile-detail-tab-prompt"
                  onSelect={() => setDetailTab("prompt")}
                >
                  Prompt
                </ProfileDetailTabButton>
              ) : null}
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
            </div>,
            pageHeaderActions
          )
        : null}
      {pageHeaderActions && canPack
        ? createPortal(
            <>
              <Button
                aria-label="Import profile"
                className="self-center"
                disabled={busy}
                onClick={() => setImportOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Upload04Icon aria-hidden className="size-3.5" />
                <span>Import</span>
              </Button>
              {selectedProfileSummary && !selectedProfileSummary.isSuper ? (
                <ExportProfileButton
                  disabled={busy}
                  profileId={selectedProfileSummary.id}
                />
              ) : null}
              {canCreateProfile && selectedId && detail && !detail.isSuper ? (
                <>
                  <Button
                    aria-label="Clone profile"
                    className="self-center"
                    disabled={busy}
                    onClick={() => handleCloneProfile(selectedId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Copy01Icon aria-hidden className="size-3.5" />
                    <span>Clone</span>
                  </Button>
                  <Button
                    aria-label="Delete profile"
                    className="self-center text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => openDeleteDialog(selectedId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Delete02Icon aria-hidden className="size-3.5" />
                    <span>Delete</span>
                  </Button>
                </>
              ) : null}
            </>,
            pageHeaderActions
          )
        : null}
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
        {profiles.length === 0 ? (
          <div className="p-4 sm:p-5">
            <ProfilesEmptyState
              canCreate={canCreateProfile}
              canImport={canPack}
              disabled={busy}
              onAskSuperBot={onAskSuperBot}
              onCreate={() => setCreateOpen(true)}
              onImport={() => setImportOpen(true)}
            />
          </div>
        ) : detailLoading && !detail ? (
          <div className="p-4 sm:p-5">
            <PageState embedded message="Loading profile…" />
          </div>
        ) : selectedId && detail ? (
          detailTab === "profile" ? (
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
          ) : detailTab === "prompt" && canCreateProfile ? (
            <div
              aria-labelledby="profile-detail-tab-prompt"
              className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
              id="profile-detail-panel-prompt"
              role="tabpanel"
            >
              <SoulTab profileId={selectedId} />
            </div>
          ) : null
        ) : selectedProfileSummary ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-4 text-center sm:p-5">
            <ProfileAvatar profile={selectedProfileSummary} size="lg" />
            <div className="space-y-1">
              <p className="font-medium text-foreground text-sm">
                {selectedProfileSummary.name}
              </p>
              <p className="text-muted-foreground text-sm">
                {selectedProfileSummary.isSuper
                  ? "Super Bot can't be exported."
                  : "Use Export above to download this profile as a pack."}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center p-4 text-center text-muted-foreground text-sm sm:p-5">
            {canCreateProfile
              ? "Select a profile to edit."
              : "Select a profile in the sidebar to export it, or use Import above to add one."}
          </div>
        )}
      </section>
    </div>
  );
}
