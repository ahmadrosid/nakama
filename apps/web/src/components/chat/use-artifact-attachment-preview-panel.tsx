import { DropdownMenuItem } from "@nakama/ui/dropdown-menu";
import { toast } from "@nakama/ui/toast";
import { Pdf01Icon } from "hugeicons-react";
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
import {
  type ArtifactPreviewMode,
  ArtifactPreviewModeToggle,
} from "@/components/chat/artifact-preview-mode-toggle";
import {
  ArtifactShareMenuItem,
  ArtifactSharePublishDialogFromState,
} from "@/components/chat/artifact-share-controls";
import { ArtifactWorkbookPreview } from "@/components/chat/artifact-workbook-preview";
import { useArtifactPreviewContent } from "@/components/chat/use-artifact-preview-content";
import {
  type ArtifactShareControlsState,
  useArtifactShareControls,
} from "@/components/chat/use-artifact-share-controls";
import { useAuth } from "@/context/use-auth";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  printArtifactHtml,
  resolveArtifactHtmlAssets,
} from "@/lib/artifact-html-preview";
import { isXlsxFile } from "@/lib/artifact-spreadsheet";
import {
  artifactCodeLanguage,
  buildArtifactContentUrl,
  type ChatArtifactRef,
  FILE_PREVIEW_MAX_BYTES,
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

function ArtifactAttachmentPreviewHeaderActions({
  artifactPath,
  content,
  copied,
  copyDisabled,
  downloadLabel,
  downloadUrl,
  filename,
  fullscreen,
  loading,
  onCopy,
  onDownloadPdf,
  onToggleFullscreen,
  share,
}: {
  artifactPath: string;
  content: string | null;
  copied: boolean;
  copyDisabled: boolean;
  downloadLabel: string;
  downloadUrl: string;
  filename: string;
  fullscreen: boolean;
  loading: boolean;
  onCopy: () => void;
  onDownloadPdf: (() => void) | null;
  onToggleFullscreen: () => void;
  share: ArtifactShareControlsState;
}) {
  return (
    <>
      <ArtifactAttachmentPanelActions
        additionalMenuItems={
          <>
            {onDownloadPdf ? (
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={loading}
                onClick={onDownloadPdf}
              >
                <Pdf01Icon aria-hidden />
                Download as PDF
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
          maxBytes: FILE_PREVIEW_MAX_BYTES,
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
  const { show, update, activeId, requestRestore } = useChatAttachmentPanel();
  // The path, not the card id: a card id can change after a reload.
  const restoreKey = `${profileId}:${artifact.path}`;

  const share = useArtifactShareControls({
    artifactPath: artifact.path,
    profileId,
  });

  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [previewMode, setPreviewMode] =
    useState<ArtifactPreviewMode>("preview");

  const { activeOrg } = useAuth();
  const downloadUrl = `${client.baseUrl}${buildArtifactContentUrl(profileId, artifact.path)}`;

  const mimeType = resolveArtifactMimeType(
    artifact.mimeType,
    artifact.filename
  );

  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isImage = isImageArtifactMimeType(mimeType);
  const isVideo = isVideoArtifactMimeType(mimeType);
  const isPdf = mimeType === "application/pdf";

  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType);

  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const isSpreadsheet = isDelimitedSpreadsheetFile(artifact.filename, mimeType);
  const isWorkbook = isXlsxFile(artifact.filename, mimeType);

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
    isPdf ||
    isWordDocument ||
    isTextArtifactMimeType(mimeType) ||
    isUnknownArtifactMimeType(mimeType);

  const downloadLabel = downloadActionLabel(mimeType);

  const {
    loading,
    error,
    content,
    imagePreviewUrl,
    videoPreviewUrl,
    pdfPreviewUrl,
    setContent,
  } = useArtifactPreviewContent({
    artifact,
    canPreview: canPreview && !isWorkbook,
    isHtml,
    isImage,
    isPdf,
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

  async function downloadPdf() {
    if (content === null) {
      return;
    }

    try {
      const scopedClient = client.forOrg(activeOrg?.id ?? null);

      const html = await resolveArtifactHtmlAssets(
        content,
        artifact.path,
        (path) =>
          scopedClient.readProfileArtifactContent(profileId, path, {
            inline: true,
          }),
        new AbortController().signal
      );

      printArtifactHtml(html);
    } catch (printError) {
      toast(formatError(printError));
    }
  }

  function buildPanelBody(
    loadingOverride?: boolean,
    mode: ArtifactPreviewMode = previewMode
  ) {
    if (isWorkbook) {
      return (
        <ArtifactWorkbookPreview
          artifact={artifact}
          key={`${activeOrg?.id}:${profileId}:${artifact.path}`}
          profileId={profileId}
        />
      );
    }

    const loadingState = loadingOverride ?? loading;

    if (isPdf) {
      return (
        <ArtifactAttachmentPanelBody
          artifact={artifact}
          canPreview={canPreview}
          error={error}
          kind="pdf"
          loading={loadingState}
          pdfPreviewUrl={pdfPreviewUrl}
        />
      );
    }

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
          profileId={profileId}
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
      bodyClassName: artifactPanelBodyClassName({
        isHtml,
        isImage,
        isMarkdown,
        isSpreadsheet: isSpreadsheet || isWorkbook,
        isVideo,
        previewMode: mode,
      }),
      content: buildPanelBody(undefined, mode),
      fullscreen,
      headerActions: (
        <ArtifactAttachmentPreviewHeaderActions
          artifactPath={artifact.path}
          content={content}
          copied={copied}
          copyDisabled={isImage || isVideo || isPdf || isWorkbook}
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
          onDownloadPdf={isHtml ? () => void downloadPdf() : null}
          onToggleFullscreen={() => setFullscreen((current) => !current)}
          share={share}
        />
      ),
      leading: showPreviewToggle ? (
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
    artifact.path,
    artifact.filename,
    artifact.sizeBytes,
    fullscreen,
    isHtml,
    isPdf,
    isImage,
    isVideo,
    isMarkdown,
    isSpreadsheet,
    isWorkbook,
    language,
    mimeType,
    loading,
    error,
    content,
    imagePreviewUrl,
    videoPreviewUrl,
    pdfPreviewUrl,
    canPreview,
    copied,
    downloadLabel,
    downloadUrl,
    share.busy,
    share.publishDialogOpen,
    previewMode,
    showPreviewToggle,
    header.subtitle,
    header.title,
    header.typeLabel,
  ]);

  function resetPanelState() {
    setFullscreen(false);
    setCopied(false);
    setPreviewMode("preview");
  }

  function showPanel() {
    show({
      ...buildPanelConfig("preview"),
      content: buildPanelBody(
        canPreview &&
          (isImage || isVideo || isPdf
            ? (imagePreviewUrl ?? videoPreviewUrl ?? pdfPreviewUrl) === null
            : content === null) &&
          error === null,
        "preview"
      ),
      defaultWidth: artifactPanelDefaultWidth(artifact.filename, mimeType),
      fullscreen: false,
      id,
      onClose: resetPanelState,
      resizable: true,
      restoreKey,
    });
  }

  function openPanel() {
    resetPanelState();
    showPanel();
  }

  // Opens again the artifact that was open when the chat was last left. The
  // card has just mounted, so its own state is already at the defaults.
  useEffect(
    () => requestRestore(restoreKey, id, showPanel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestRestore, restoreKey, id]
  );

  return {
    imagePreviewUrl,
    isImage,
    isVideo,
    openPanel,
  };
}
