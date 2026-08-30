import { createPortal } from "react-dom";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { KnowledgeTab } from "@/components/soul-tools/KnowledgeTab";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import { ProfileHistoryTab } from "@/pages/profiles/profile-history-tab";
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
  } = state;
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canCreateProfile = user?.isPlatformAdmin === true;
  const canPack = isOrgAdmin || canCreateProfile;
  const canViewHistory = isOrgAdmin || canCreateProfile;
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
              {canCreateProfile || canViewHistory ? (
                <ProfileDetailTabButton
                  active={detailTab === "prompt"}
                  controls="profile-detail-panel-prompt"
                  id="profile-detail-tab-prompt"
                  onSelect={() => setDetailTab("prompt")}
                >
                  Prompt
                </ProfileDetailTabButton>
              ) : null}
              <ProfileDetailTabButton
                active={detailTab === "knowledge"}
                controls="profile-detail-panel-knowledge"
                id="profile-detail-tab-knowledge"
                onSelect={() => setDetailTab("knowledge")}
              >
                Knowledge
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
            </div>,
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
          ) : detailTab === "prompt" && (canCreateProfile || canViewHistory) ? (
            <div
              aria-labelledby="profile-detail-tab-prompt"
              className="no-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-5"
              id="profile-detail-panel-prompt"
              role="tabpanel"
            >
              {canCreateProfile ? <SoulTab profileId={selectedId} /> : null}
              {canViewHistory ? (
                <ProfileHistoryTab profileId={selectedId} />
              ) : null}
            </div>
          ) : detailTab === "knowledge" ? (
            <div
              aria-labelledby="profile-detail-tab-knowledge"
              className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
              id="profile-detail-panel-knowledge"
              role="tabpanel"
            >
              <KnowledgeTab profileId={selectedId} />
            </div>
          ) : null
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
