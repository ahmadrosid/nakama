import type { WorkspaceEntry } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Download04Icon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { ArtifactAttachmentPanelActions } from "@/components/chat/artifact-attachment-panel-actions";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelHeaderMeta,
  downloadActionLabel,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import {
  type ArtifactPreviewMode,
  ArtifactPreviewModeToggle,
} from "@/components/chat/artifact-preview-mode-toggle";
import { useAuth } from "@/context/use-auth";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  artifactCodeLanguage,
  isDocxFile,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  isTextArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";
import { canPreviewWorkspaceEntry } from "@/lib/files-page.shared";
import { formatBytes } from "@/lib/knowledge-base-files";
import { artifactBasename } from "@/pages/files/files-artifact-folders";
import { ArtifactIcon } from "@/pages/files/files-artifact-icon";
import { toChatArtifactRef } from "@/pages/files/files-shared";

export function WorkspaceFilePreview({
  entry,
  profileId,
  onClose,
  id = `workspace:${profileId}:${entry.path}`,
}: {
  entry: WorkspaceEntry;
  profileId: string;
  onClose: () => void;
  id?: string;
}) {
  const { activeOrg } = useAuth();
  const { show, update, hide } = useChatAttachmentPanel();
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [previewMode, setPreviewMode] =
    useState<ArtifactPreviewMode>("preview");

  // A Word file has no text of its own to show, so the server converts it and
  // it is previewed as the markdown it comes back as.
  const isWordDocument =
    isDocxFile(entry.filename, entry.mimeType) ||
    isLegacyDocFile(entry.filename, entry.mimeType);

  const isMarkdown =
    isMarkdownArtifactMimeType(entry.mimeType) || isWordDocument;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const isImage = entry.mimeType.startsWith("image/");
  const isVideo = entry.mimeType.startsWith("video/");
  const isPdf = entry.mimeType === "application/pdf";

  const isText =
    isTextArtifactMimeType(entry.mimeType) ||
    isWordDocument ||
    artifactCodeLanguage(entry.filename) !== null;

  const canPreview = canPreviewWorkspaceEntry({
    isImage,
    isPdf,
    isText,
    isVideo,
    isWordDocument,
    sizeBytes: entry.sizeBytes,
  });

  const { data, isLoading, error } = useQuery({
    enabled: canPreview,
    queryFn: async () => {
      const blob = await client.readProfileWorkspaceFile(
        profileId,
        entry.path,
        {
          render: isWordDocument ? "markdown" : undefined,
        }
      );

      return { blob, text: isText ? await blob.text() : null };
    },
    queryKey: [
      "workspace-preview",
      activeOrg?.id,
      profileId,
      entry.path,
      entry.updatedAt,
    ],
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    const url = URL.createObjectURL(data.blob);
    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [data]);
  const downloadUrl = `${client.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/workspace/content?${new URLSearchParams({ path: entry.path })}`;
  useEffect(() => {
    show({
      content: null,
      defaultWidth: artifactPanelDefaultWidth(entry.filename, entry.mimeType),
      id,
      onClose,
      title: entry.filename,
    });

    return () => hide(id);
  }, [id, entry.filename, entry.mimeType, show, hide, onClose]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 2000);

    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const header = artifactPanelHeaderMeta({
      filename: entry.filename,
      mimeType: entry.mimeType,
      showPreviewToggle: isMarkdown,
    });

    update(id, {
      ...header,
      bodyClassName: artifactPanelBodyClassName({
        isHtml: false,
        isImage,
        isMarkdown,
        isVideo,
        previewMode,
      }),
      content: (
        <WorkspacePreviewBody
          canPreview={canPreview}
          content={data?.text ?? null}
          downloadUrl={downloadUrl}
          entry={entry}
          error={error}
          isMarkdown={isMarkdown}
          loading={isLoading}
          objectUrl={objectUrl}
          previewMode={previewMode}
        />
      ),
      fullscreen,
      headerActions: (
        <ArtifactAttachmentPanelActions
          content={data?.text ?? null}
          copied={copied}
          copyDisabled={data?.text == null}
          downloadLabel={downloadActionLabel(entry.mimeType)}
          downloadUrl={downloadUrl}
          filename={artifactBasename(entry.filename)}
          fullscreen={fullscreen}
          loading={isLoading}
          onCopy={async () => {
            if (data?.text == null) {
              return;
            }

            try {
              await navigator.clipboard.writeText(data.text);
              setCopied(true);
            } catch {
              // Clipboard may be unavailable outside secure contexts.
            }
          }}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
        />
      ),
      leading: isMarkdown ? (
        <ArtifactPreviewModeToggle
          mode={previewMode}
          onChange={setPreviewMode}
        />
      ) : null,
      resizable: !fullscreen,
    });
  }, [
    id,
    update,
    entry,
    isMarkdown,
    isImage,
    isVideo,
    fullscreen,
    copied,
    previewMode,
    data,
    isLoading,
    error,
    downloadUrl,
    objectUrl,
    canPreview,
  ]);

  return null;
}

function WorkspacePreviewBody({
  previewMode,
  entry,
  objectUrl,
  content,
  loading,
  error,
  canPreview,
  downloadUrl,
  isMarkdown,
}: {
  entry: WorkspaceEntry;
  objectUrl: string | null;
  content: string | null;
  loading: boolean;
  error: unknown;
  canPreview: boolean;
  downloadUrl: string;
  isMarkdown: boolean;
  previewMode: ArtifactPreviewMode;
}) {
  if (!canPreview) {
    return (
      <div className="flex min-h-64 flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center rounded-xl border border-border bg-muted/20 px-6 py-8 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-xl border border-border bg-background">
            <ArtifactIcon
              className="size-7"
              filename={entry.filename}
              mimeType={entry.mimeType}
            />
          </div>
          <h3 className="font-medium text-sm">Preview unavailable</h3>
          <p className="mt-2 max-w-full break-all text-muted-foreground text-sm">
            {artifactBasename(entry.filename)}
          </p>
          <p className="mt-1 text-muted-foreground text-xs tabular-nums">
            {formatBytes(entry.sizeBytes)}
          </p>
          <Button
            className="mt-5 min-h-10"
            nativeButton={false}
            render={
              <a
                aria-label={`Download ${artifactBasename(entry.filename)}`}
                download={artifactBasename(entry.filename)}
                href={downloadUrl}
              />
            }
          >
            <Download04Icon aria-hidden className="size-4" />
            Download file
          </Button>
        </div>
      </div>
    );
  }

  const shared = {
    artifact: toChatArtifactRef(entry),
    canPreview,
    error: error ? formatError(error) : null,
    loading,
    previewMode,
  };

  if (entry.mimeType.startsWith("image/")) {
    return (
      <ArtifactAttachmentPanelBody
        {...shared}
        imagePreviewUrl={objectUrl}
        kind="image"
      />
    );
  }

  if (entry.mimeType.startsWith("video/")) {
    return (
      <ArtifactAttachmentPanelBody
        {...shared}
        kind="video"
        videoPreviewUrl={objectUrl}
      />
    );
  }

  if (entry.mimeType === "application/pdf") {
    return (
      <ArtifactAttachmentPanelBody
        {...shared}
        kind="pdf"
        pdfPreviewUrl={objectUrl}
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      {...shared}
      content={content}
      format={isMarkdown ? "markdown" : "plain"}
      kind="text"
      language={artifactCodeLanguage(entry.filename)}
    />
  );
}
