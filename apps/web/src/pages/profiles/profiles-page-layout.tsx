import { NakamaApiError } from "@nakama/core/api-error";
import { Button } from "@nakama/ui/button";
import { SquareLock02Icon } from "hugeicons-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { PAGE_PATHS, teamDetailPath } from "@/lib/navigation";
import { resolveSuperBotChatProfileId } from "@/lib/profiles";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import { PageState, ProfilesEmptyState } from "@/pages/profiles/profiles-ui";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

function useProfilesPageLayoutMeta(state: ProfilesPageState) {
  const { profiles } = state;
  const { user, activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const canCreateProfile = user?.isPlatformAdmin === true;
  const canPack = isOrgAdmin || canCreateProfile;
  const { navigateToNewChat } = useAppNavigation();
  const superBotProfileId = resolveSuperBotChatProfileId(profiles);

  const onAskSuperBot = superBotProfileId
    ? () => navigateToNewChat(superBotProfileId)
    : undefined;

  return {
    canCreateProfile,
    canPack,
    onAskSuperBot,
  };
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

function isForbiddenError(error: Error | null): boolean {
  return error instanceof NakamaApiError && error.status === 403;
}

function ProfileForbiddenState() {
  const { activeOrg } = useAuth();
  const role = activeOrg?.role === "admin" ? "Admin" : "Member";

  return (
    <div
      aria-labelledby="profile-forbidden-title"
      className="flex min-h-[min(24rem,60dvh)] flex-col items-center justify-center gap-6 px-4 py-10 text-center sm:px-6"
      role="status"
    >
      <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/40">
        <SquareLock02Icon
          aria-hidden
          className="size-6 text-muted-foreground"
        />
      </div>

      <div className="max-w-sm space-y-1.5">
        <p
          className="type-section-title font-medium text-foreground"
          id="profile-forbidden-title"
        >
          You can't open this agent
        </p>
        <p className="type-body text-muted-foreground text-sm">
          Your role in{" "}
          <span className="font-medium text-foreground">
            {activeOrg?.name ?? "this team"}
          </span>{" "}
          is {role}. Ask the owner or an admin to share it with you.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link to={PAGE_PATHS.chat} />} type="button">
          Back to chat
        </Button>
        {activeOrg ? (
          <Button
            render={<Link to={teamDetailPath(activeOrg.id)} />}
            type="button"
            variant="outline"
          >
            See admins
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ProfilesMainSection({
  state,
  canCreateProfile,
  canPack,
  onAskSuperBot,
}: {
  state: ProfilesPageState;
  canCreateProfile: boolean;
  canPack: boolean;
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
    detailError,
  } = state;

  if (selectedId && isForbiddenError(detailError)) {
    return <ProfileForbiddenState />;
  }

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
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <ProfileConfigTab state={state} />
      </div>
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
    refetchDetail,
    detailError,
  } = state;

  const { canCreateProfile, canPack, onAskSuperBot } =
    useProfilesPageLayoutMeta(state);

  if (profilesLoading && profiles.length === 0) {
    return <PageState message="Loading profiles…" />;
  }

  return (
    <div className="space-y-4">
      <ProfilesPageError
        error={isForbiddenError(detailError) ? null : error}
        onRetry={() => void refetchDetail()}
        selectedId={selectedId}
      />

      <section className="flex min-h-[calc(100svh-7rem)] flex-col overflow-hidden">
        <ProfilesMainSection
          canCreateProfile={canCreateProfile}
          canPack={canPack}
          onAskSuperBot={onAskSuperBot}
          state={state}
        />
      </section>
    </div>
  );
}
