import type { ArtifactFile } from "@nakama/core/contract";
import { useMemo, useState } from "react";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  type ArtifactTypeFilter,
  artifactMatchesTypeFilter,
  availableArtifactTypeFilters,
} from "@/components/soul-tools/artifacts-tab-filters";
import { KnowledgeTab } from "@/components/soul-tools/KnowledgeTab";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useArtifactsQuery,
  useDeleteArtifactMutation,
} from "@/hooks/use-resource-mutations";
import {
  type FilesViewMode,
  getStoredFilesViewMode,
  resolveFilesProfileId,
  setStoredFilesViewMode,
} from "@/lib/files-page.shared";
import { FilesArtifactViews } from "@/pages/files/files-artifact-views";
import { FilesDeleteDialog } from "@/pages/files/files-delete-dialog";
import { FilesSearchRow } from "@/pages/files/files-search-row";
import { FilesToolbar } from "@/pages/files/files-toolbar";
import { ProfileDetailTabButton } from "@/pages/profiles/profiles-ui";

const EMPTY_ARTIFACTS: ArtifactFile[] = [];
type FilesPageView = "artifacts" | "knowledge";

export function FilesPage() {
  const { profileId: activeProfileId } = useActiveChatProfile();
  const { data: profiles = [] } = useProfilesQuery();
  const profileId = resolveFilesProfileId({ activeProfileId, profiles });
  const [view, setView] = useState<FilesPageView>("artifacts");

  const [deleteTarget, setDeleteTarget] = useState<ArtifactFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>("all");
  const [viewMode, setViewMode] = useState<FilesViewMode>(() =>
    getStoredFilesViewMode()
  );
  const { data, isLoading, isFetching, error, refetch } =
    useArtifactsQuery(profileId);
  const deleteMutation = useDeleteArtifactMutation();

  const artifacts = data?.artifacts ?? EMPTY_ARTIFACTS;
  const typeOptions = useMemo(
    () => availableArtifactTypeFilters(artifacts),
    [artifacts]
  );
  const effectiveTypeFilter: ArtifactTypeFilter = typeOptions.includes(
    typeFilter
  )
    ? typeFilter
    : "all";

  const filteredArtifacts = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();

    return artifacts.filter((artifact) => {
      if (!artifactMatchesTypeFilter(artifact, effectiveTypeFilter)) {
        return false;
      }

      if (!trimmed) {
        return true;
      }

      const haystack =
        `${artifact.filename} ${artifact.mimeType}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [artifacts, searchQuery, effectiveTypeFilter]);

  function handleViewModeChange(mode: FilesViewMode) {
    setViewMode(mode);
    setStoredFilesViewMode(mode);
  }

  if (!profileId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center text-muted-foreground text-sm">
          No profiles available.
        </div>
      </div>
    );
  }

  async function handleDelete() {
    if (!(profileId && deleteTarget)) {
      return;
    }

    await deleteMutation.mutateAsync({
      filename: deleteTarget.filename,
      profileId,
    });
    setDeleteTarget(null);
  }

  const emptyFilterMessage = (() => {
    const parts: string[] = [];
    if (effectiveTypeFilter !== "all") {
      parts.push(
        ARTIFACT_TYPE_FILTER_LABELS[effectiveTypeFilter].toLowerCase()
      );
    }
    const trimmed = searchQuery.trim();
    if (trimmed) {
      parts.push(`“${trimmed}”`);
    }
    if (parts.length === 0) {
      return "No artifacts match.";
    }
    return `No artifacts match ${parts.join(" · ")}.`;
  })();

  return (
    <ChatAttachmentPanelProvider presentation="overlay">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-4">
          <div
            aria-label="Files views"
            className="flex min-w-0 items-stretch border-border border-b"
            role="tablist"
          >
            <ProfileDetailTabButton
              active={view === "artifacts"}
              controls="files-page-panel-artifacts"
              id="files-page-tab-artifacts"
              onSelect={() => setView("artifacts")}
            >
              Artifacts
            </ProfileDetailTabButton>
            <ProfileDetailTabButton
              active={view === "knowledge"}
              controls="files-page-panel-knowledge"
              id="files-page-tab-knowledge"
              onSelect={() => setView("knowledge")}
            >
              Knowledge base
            </ProfileDetailTabButton>
          </div>

          {view === "artifacts" ? (
            <div
              aria-labelledby="files-page-tab-artifacts"
              className="space-y-4"
              id="files-page-panel-artifacts"
              role="tabpanel"
            >
              <FilesToolbar
                isFetching={isFetching}
                onRefresh={() => void refetch()}
                onViewModeChange={handleViewModeChange}
                showViewModeToggle={artifacts.length > 0}
                viewMode={viewMode}
              />

              {artifacts.length > 0 ? (
                <FilesSearchRow
                  onSearchQueryChange={setSearchQuery}
                  onTypeFilterChange={setTypeFilter}
                  searchQuery={searchQuery}
                  typeFilter={effectiveTypeFilter}
                  typeOptions={typeOptions}
                />
              ) : null}

              <FilesArtifactViews
                artifacts={artifacts}
                deletePending={deleteMutation.isPending}
                emptyFilterMessage={emptyFilterMessage}
                error={error}
                filteredArtifacts={filteredArtifacts}
                isLoading={isLoading}
                onDelete={setDeleteTarget}
                profileId={profileId}
                viewMode={viewMode}
              />
            </div>
          ) : (
            <div
              aria-labelledby="files-page-tab-knowledge"
              id="files-page-panel-knowledge"
              role="tabpanel"
            >
              <KnowledgeTab profileId={profileId} />
            </div>
          )}
        </div>
      </div>

      <FilesDeleteDialog
        deletePending={deleteMutation.isPending}
        deleteTarget={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </ChatAttachmentPanelProvider>
  );
}
