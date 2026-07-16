import { PlusIcon, Trash2Icon } from "lucide-react";
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
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { cn } from "@/lib/utils";
import { ProfileConfigTab } from "@/pages/profiles/profile-config-tab";
import { sectionClass } from "@/pages/profiles/profiles-page.shared";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";
import {
  EmptyMessage,
  PageState,
  ProfileDetailTabButton,
  ProfileScopeButton,
  ProfileSearch,
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
    searchQuery,
    setSearchQuery,
    isSearching,
    refreshing,
    filteredProfiles,
    detailTab,
    setDetailTab,
    handleSelectProfile,
    setCreateOpen,
    openDeleteDialog,
  } = state;

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

        <section className={cn(sectionClass, "overflow-hidden")}>
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
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <aside className="hidden shrink-0 border-b border-border p-4 lg:block lg:w-56 lg:border-r lg:border-b-0">
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
                <nav aria-label="Profiles" className="flex flex-col gap-1">
                  {filteredProfiles.map((profile) => (
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
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
                    <div
                      role="tablist"
                      aria-label="Profile settings"
                      className="flex min-w-0 flex-1"
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
                    {!detail.isSuper ? (
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
                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    {detailTab === "profile" ? (
                      <ProfileConfigTab state={state} />
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
  );
}
