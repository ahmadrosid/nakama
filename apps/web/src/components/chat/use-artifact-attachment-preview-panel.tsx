import { DropdownMenuItem } from "@nakama/ui/dropdown-menu";
import { PencilEdit01Icon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { ArtifactAttachmentPanelActions } from "@/components/chat/artifact-attachment-panel-actions";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactCanTogglePreviewSource,
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelHeaderMeta,
  downloadActionLabel,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import { ArtifactMarkdownEditor } from "@/components/chat/artifact-markdown-editor";
import {
  type ArtifactPreviewMode,
  ArtifactPreviewModeToggle,
} from "@/components/chat/artifact-preview-mode-toggle";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { ArtifactSpreadsheetEditor } from "@/components/chat/artifact-spreadsheet-editor";
import { useArtifactPreviewContent } from "@/components/chat/use-artifact-preview-content";
import {
  type ArtifactShareControlsState,
  useArtifactShareControls,
} from "@/components/chat/use-artifact-share-controls";
import { useAuth } from "@/context/use-auth";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { useWriteArtifactMutation } from "@/hooks/use-resource-mutations";
import {
  artifactCodeLanguage,
  buildArtifactContentUrl,
  type ChatArtifactRef,
  isDelimitedSpreadsheetFile,
  isDocxFile,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
  isUnknownArtifactMimeType,
  isVideoArtifactMimeType,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";

type EditMode = null | "markdown" | "spreadsheet";

function ArtifactAttachmentPreviewHeaderActions({
  artifactPath,
  canEdit,
  content,
  copied,
  copyDisabled,
  downloadLabel,
  downloadUrl,
  filename,
  fullscreen,
  loading,
  onCopy,
  onEdit,
  onToggleFullscreen,
  share,
}: {
  artifactPath: string;
  canEdit: boolean;
  content: string | null;
  copied: boolean;
  copyDisabled: boolean;
  downloadLabel: string;
  downloadUrl: string;
  filename: string;
  fullscreen: boolean;
  loading: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onToggleFullscreen: () => void;
  share: ArtifactShareControlsState;
}) {
  return (
    <>
      <ArtifactAttachmentPanelActions
        additionalMenuItems={
          <>
            {canEdit ? (
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={loading || content === null}
                onClick={onEdit}
              >
                <PencilEdit01Icon aria-hidden />
                Edit artifact
              </DropdownMenuItem>
            ) : null}
            <ArtifactShareMenuItem share={share} />
          </>
        }
        content={content}
        copied={copied}
        copyDisabled={copyDisabled}
        downloadLabel={downloadLabel}
        downloadUrl={downloadUrl}
        filename={filename}
        fullscreen={fullscreen}
        loading={loading}
        onCopy={onCopy}
        onToggleFullscreen={onToggleFullscreen}
      />
      <ArtifactSharePublishDialogFromState
        artifactPath={artifactPath}
        share={share}
      />
    </>
  );
}

async function copyArtifactContent({
  isImage,
  isVideo,
  isWordDocument,
  content,
  profileId,
  artifactPath,
  setContent,
  setCopied,
}: {
  isImage: boolean;
  isVideo: boolean;
  isWordDocument: boolean;
  content: string | null;
  profileId: string;
  artifactPath: string;
  setContent: (value: string) => void;
  setCopied: (value: boolean) => void;
}) {
  if (isImage || isVideo) {
    return;
  }

  try {
    let text = content;
    if (!text) {
      const result = await client.readProfileArtifactContent(
        profileId,
        artifactPath,
        {
          inline: true,
          render: isWordDocument ? "markdown" : undefined,
        }
      );
      text = new TextDecoder().decode(result.data);
      setContent(text);
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);
  } catch {
    // Clipboard may be unavailable outside secure contexts.
  }
}

export function useArtifactAttachmentPreviewPanel({
  profileId,
  id,
  artifact,
}: {
  profileId: string;
  id: string;
  artifact: ChatArtifactRef;
}) {
  const { show, update, activeId } = useChatAttachmentPanel();
  const share = useArtifactShareControls({
    artifactPath: artifact.path,
    profileId,
  });
  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] =
    useState<ArtifactPreviewMode>("preview");
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const { activeOrg } = useAuth();
  const writeArtifact = useWriteArtifactMutation();
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;
  const mimeType = resolveArtifactMimeType(
    artifact.mimeType,
    artifact.filename
  );
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isVideo = isVideoArtifactMimeType(mimeType);
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const isSpreadsheet = isDelimitedSpreadsheetFile(artifact.filename, mimeType);
  const showPreviewToggle = artifactCanTogglePreviewSource({
    isHtml,
    isMarkdown,
    isSpreadsheet,
  });
  const header = artifactPanelHeaderMeta({
    filename: artifact.filename,
    mimeType,
    showPreviewToggle,
    sizeBytes: artifact.sizeBytes,
  });
  const language = artifactCodeLanguage(artifact.filename);
  const canPreview =
    isHtml ||
    isImage ||
    isVideo ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);
  const downloadLabel = downloadActionLabel(mimeType);
  const canEdit =
    ((isMarkdown && !isWordDocument) || isSpreadsheet) &&
    activeOrg?.role !== "viewer";
  const {
    loading,
    error,
    content,
    imagePreviewUrl,
    videoPreviewUrl,
    setContent,
  } = useArtifactPreviewContent({
    artifact,
    canPreview,
    isHtml,
    isImage,
    isVideo,
    isWordDocument,
    open,
    profileId,
  });

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function saveDraft(nextContent: string) {
    if (editMode === null) {
      return;
    }

    setSaveError(null);

    try {
      await writeArtifact.mutateAsync({
        artifactPath: artifact.path,
        content: nextContent,
        profileId,
      });
      setContent(nextContent);
      setEditMode(null);
    } catch (mutationError) {
      setSaveError(formatError(mutationError));
    }
  }

  function buildPanelBody(
    loadingOverride?: boolean,
    mode: ArtifactPreviewMode = previewMode
  ) {
    if (editMode === "spreadsheet" && content !== null) {
      return (
        <ArtifactSpreadsheetEditor
          busy={writeArtifact.isPending}
          content={content}
          error={saveError}
          filename={artifact.filename}
          onCancel={() => {
            setEditMode(null);
            setSaveError(null);
          }}
          onSave={(nextContent) => void saveDraft(nextContent)}
        />
      );
    }

    if (editMode === "markdown") {
      return (
        <ArtifactMarkdownEditor
          busy={writeArtifact.isPending}
          draft={draft}
          error={saveError}
          onCancel={() => {
            setEditMode(null);
            setSaveError(null);
          }}
          onChange={setDraft}
          onSave={() => void saveDraft(draft)}
        />
      );
    }

    const loadingState = loadingOverride ?? loading;

    if (isImage) {
      return (
        <ArtifactAttachmentPanelBody
          artifact={artifact}
          canPreview={canPreview}
          error={error}
          imagePreviewUrl={imagePreviewUrl}
          kind="image"
          loading={loadingState}
        />
      );
    }

    if (isVideo) {
      return (
        <ArtifactAttachmentPanelBody
          artifact={artifact}
          canPreview={canPreview}
          error={error}
          kind="video"
          loading={loadingState}
          videoPreviewUrl={videoPreviewUrl}
        />
      );
    }

    if (isHtml) {
      return (
        <ArtifactAttachmentPanelBody
          artifact={artifact}
          canPreview={canPreview}
          content={content}
          error={error}
          kind="html"
          loading={loadingState}
          previewMode={mode}
        />
      );
    }

    if (isSpreadsheet) {
      return (
        <ArtifactAttachmentPanelBody
          artifact={artifact}
          canPreview={canPreview}
          content={content}
          error={error}
          kind="spreadsheet"
          loading={loadingState}
          previewMode={mode}
        />
      );
    }

    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview={canPreview}
        content={content}
        error={error}
        format={isMarkdown ? "markdown" : "plain"}
        kind="text"
        language={language}
        loading={loadingState}
        previewMode={mode}
      />
    );
  }

  function buildPanelConfig(mode: ArtifactPreviewMode = previewMode) {
    return {
      bodyClassName:
        editMode === null
          ? artifactPanelBodyClassName({
              isHtml,
              isImage,
              isMarkdown,
              isSpreadsheet,
              isVideo,
              previewMode: mode,
            })
          : "flex flex-col overflow-hidden p-0",
      content: buildPanelBody(undefined, mode),
      fullscreen,
      headerActions: (
        <ArtifactAttachmentPreviewHeaderActions
          artifactPath={artifact.path}
          canEdit={canEdit}
          content={content}
          copied={copied}
          copyDisabled={isImage || isVideo}
          downloadLabel={downloadLabel}
          downloadUrl={downloadUrl}
          filename={artifact.filename}
          fullscreen={fullscreen}
          loading={loading}
          onCopy={() =>
            void copyArtifactContent({
              artifactPath: artifact.path,
              content,
              isImage,
              isVideo,
              isWordDocument,
              profileId,
              setContent,
              setCopied,
            })
          }
          onEdit={() => {
            setSaveError(null);
            if (isSpreadsheet) {
              setEditMode("spreadsheet");
              return;
            }
            setDraft(content ?? "");
            setEditMode("markdown");
          }}
          onToggleFullscreen={() => setFullscreen((current) => !current)}
          share={share}
        />
      ),
      leading:
        showPreviewToggle && editMode === null ? (
          <ArtifactPreviewModeToggle mode={mode} onChange={setPreviewMode} />
        ) : null,
      resizable: !fullscreen,
      subtitle: header.subtitle,
      title: header.title,
      typeLabel: header.typeLabel,
    };
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    update(id, buildPanelConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    update,
    id,
    artifact,
    fullscreen,
    isHtml,
    isImage,
    isVideo,
    isMarkdown,
    isSpreadsheet,
    language,
    mimeType,
    loading,
    error,
    content,
    imagePreviewUrl,
    videoPreviewUrl,
    canPreview,
    copied,
    downloadLabel,
    downloadUrl,
    share.busy,
    share.publishDialogOpen,
    previewMode,
    canEdit,
    editMode,
    draft,
    saveError,
    writeArtifact.isPending,
    showPreviewToggle,
    header.subtitle,
    header.title,
    header.typeLabel,
  ]);

  function openPanel() {
    setFullscreen(false);
    setCopied(false);
    setPreviewMode("preview");
    setEditMode(null);
    setSaveError(null);
    show({
      ...buildPanelConfig("preview"),
      content: buildPanelBody(
        canPreview &&
          (isImage || isVideo
            ? (isImage ? imagePreviewUrl : videoPreviewUrl) === null
            : content === null) &&
          error === null,
        "preview"
      ),
      defaultWidth: artifactPanelDefaultWidth(artifact.filename, mimeType),
      fullscreen: false,
      id,
      onClose: () => {
        setFullscreen(false);
        setCopied(false);
        setPreviewMode("preview");
        setEditMode(null);
        setSaveError(null);
      },
      resizable: true,
    });
  }

  return {
    imagePreviewUrl,
    isImage,
    isVideo,
    openPanel,
  };
}
