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

function useProfilesPageLayoutMeta(state: ProfilesPageState) {
  const { profiles, selectedId } = state;
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canCreateProfile = user?.isPlatformAdmin === true;
  const canPack = isOrgAdmin || canCreateProfile;
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

  return {
    activeOrg,
    canCreateProfile,
    canPack,
    isOrgAdmin,
    onAskSuperBot,
    pageHeaderActions,
    pendingSkillProposals,
  };
}

function formatPendingProposalCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function ProfilesHeaderTabs({
  detailTab,
  setDetailTab,
  canPack,
  isOrgAdmin,
  pendingSkillProposals,
}: {
  detailTab: ProfilesPageState["detailTab"];
  setDetailTab: ProfilesPageState["setDetailTab"];
  canPack: boolean;
  isOrgAdmin: boolean;
  pendingSkillProposals: number;
}) {
  return (
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
      {canPack ? (
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
              ({formatPendingProposalCount(pendingSkillProposals)})
            </span>
          ) : null}
        </ProfileDetailTabButton>
      ) : null}
    </div>
  );
}

function ProfilesPageError({
  error,
  selectedId,
  onRetry,
}: {
  error: string | null;
  selectedId: string | null;
  onRetry: () => void;
}) {
  if (!error) {
    return null;
  }

  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
      {error}
      {selectedId ? (
        <>
          {" "}
          <button
            className="underline underline-offset-2"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        </>
      ) : null}
    </p>
  );
}

function ProfilesProposalsTab({
  orgId,
  profileId,
}: {
  orgId: string;
  profileId: string;
}) {
  return (
    <div
      aria-labelledby="profile-detail-tab-proposals"
      className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
      id="profile-detail-panel-proposals"
      role="tabpanel"
    >
      <SkillProposalsPanel orgId={orgId} profileId={profileId} />
    </div>
  );
}

function ProfilesPromptTab({
  profileId,
  canCreateProfile,
}: {
  profileId: string;
  canCreateProfile: boolean;
}) {
  return (
    <div
      aria-labelledby="profile-detail-tab-prompt"
      className="no-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-5"
      id="profile-detail-panel-prompt"
      role="tabpanel"
    >
      {canCreateProfile ? <SoulTab profileId={profileId} /> : null}
      <ProfileHistoryTab profileId={profileId} />
    </div>
  );
}

function ProfilesKnowledgeTab({ profileId }: { profileId: string }) {
  return (
    <div
      aria-labelledby="profile-detail-tab-knowledge"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      id="profile-detail-panel-knowledge"
      role="tabpanel"
    >
      <KnowledgeTab profileId={profileId} />
    </div>
  );
}

function ProfilesDetailPanel({
  state,
  orgId,
  isOrgAdmin,
  canPack,
  canCreateProfile,
}: {
  state: ProfilesPageState;
  orgId?: string;
  isOrgAdmin: boolean;
  canPack: boolean;
  canCreateProfile: boolean;
}) {
  const { selectedId, detailTab } = state;

  if (detailTab === "profile") {
    return (
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <ProfileConfigTab state={state} />
      </div>
    );
  }

  if (detailTab === "proposals" && isOrgAdmin && orgId && selectedId) {
    return <ProfilesProposalsTab orgId={orgId} profileId={selectedId} />;
  }

  if (detailTab === "prompt" && canPack && selectedId) {
    return (
      <ProfilesPromptTab
        canCreateProfile={canCreateProfile}
        profileId={selectedId}
      />
    );
  }

  if (detailTab === "knowledge" && selectedId) {
    return <ProfilesKnowledgeTab profileId={selectedId} />;
  }

  return null;
}

function ProfilesMainSection({
  state,
  orgId,
  canCreateProfile,
  canPack,
  isOrgAdmin,
  onAskSuperBot,
}: {
  state: ProfilesPageState;
  orgId?: string;
  canCreateProfile: boolean;
  canPack: boolean;
  isOrgAdmin: boolean;
  onAskSuperBot?: () => void;
}) {
  const {
    profiles,
    busy,
    selectedId,
    detail,
    detailLoading,
    setCreateOpen,
    setImportOpen,
  } = state;

  if (profiles.length === 0) {
    return (
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
    );
  }

  if (detailLoading && !detail) {
    return (
      <div className="p-4 sm:p-5">
        <PageState embedded message="Loading profile…" />
      </div>
    );
  }

  if (selectedId && detail) {
    return (
      <ProfilesDetailPanel
        canCreateProfile={canCreateProfile}
        canPack={canPack}
        isOrgAdmin={isOrgAdmin}
        orgId={orgId}
        state={state}
      />
    );
  }

  return (
    <div className="flex min-h-48 items-center justify-center p-4 text-center text-muted-foreground text-sm sm:p-5">
      {canCreateProfile
        ? "Select a profile to edit."
        : "Select a profile in the sidebar to export it, or use Import above to add one."}
    </div>
  );
}

export function ProfilesPageLayout(state: ProfilesPageState) {
  const {
    profiles,
    profilesLoading,
    error,
    selectedId,
    detail,
    refetchDetail,
    detailTab,
    setDetailTab,
  } = state;
  const {
    activeOrg,
    canCreateProfile,
    canPack,
    isOrgAdmin,
    onAskSuperBot,
    pageHeaderActions,
    pendingSkillProposals,
  } = useProfilesPageLayoutMeta(state);

  if (profilesLoading && profiles.length === 0) {
    return <PageState message="Loading profiles…" />;
  }

  return (
    <div className="space-y-4">
      {pageHeaderActions && selectedId && detail
        ? createPortal(
            <ProfilesHeaderTabs
              canPack={canPack}
              detailTab={detailTab}
              isOrgAdmin={isOrgAdmin}
              pendingSkillProposals={pendingSkillProposals}
              setDetailTab={setDetailTab}
            />,
            pageHeaderActions
          )
        : null}
      <ProfilesPageError
        error={error}
        onRetry={() => void refetchDetail()}
        selectedId={selectedId}
      />

      <section
        className={cn(
          sectionClass,
          "flex min-h-[calc(100svh-7rem)] flex-col overflow-hidden"
        )}
      >
        <ProfilesMainSection
          canCreateProfile={canCreateProfile}
          canPack={canPack}
          isOrgAdmin={isOrgAdmin}
          onAskSuperBot={onAskSuperBot}
          orgId={activeOrg?.id}
          state={state}
        />
      </section>
    </div>
  );
}
