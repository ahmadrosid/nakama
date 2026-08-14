import type { KnowledgeBaseDocument } from "@nakama/core/contract";
import { ViewIcon } from "hugeicons-react";
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
import { useKnowledgeDocumentPreviewContent } from "@/components/soul-tools/use-knowledge-document-preview-content";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  artifactCodeLanguage,
  type ChatArtifactRef,
  isMarkdownArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";

function buildKnowledgeDocumentContentUrl(
  profileId: string,
  documentId: string,
  options: { inline?: boolean; render?: "text" } = {}
): string {
  const query = new URLSearchParams();
  if (options.inline) {
    query.set("inline", "1");
  }
  if (options.render) {
    query.set("render", options.render);
  }
  const queryString = query.toString();
  return `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/${encodeURIComponent(documentId)}/content${queryString ? `?${queryString}` : ""}`;
}

function toArtifactRef(document: KnowledgeBaseDocument): ChatArtifactRef {
  return {
    filename: document.filename,
    mimeType: document.mediaType,
    path: document.id,
    savedAt: document.uploadedAt,
    sizeBytes: document.sizeBytes,
  };
}

export function KnowledgeDocumentPreview({
  profileId,
  document,
  className,
}: {
  profileId: string;
  document: KnowledgeBaseDocument;
  className?: string;
}) {
  const { show, update, activeId } = useChatAttachmentPanel();
  const id = `kb-doc-${document.id}`;
  const open = activeId === id;
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] =
    useState<ArtifactPreviewMode>("preview");

  const canPreview = document.status === "ready";
  const downloadUrl = `${client.baseUrl}${buildKnowledgeDocumentContentUrl(profileId, document.id)}`;
  const isMarkdown = isMarkdownArtifactMimeType(document.mediaType);
  const showPreviewToggle = artifactCanTogglePreviewSource({
    isHtml: false,
    isMarkdown,
  });
  const header = artifactPanelHeaderMeta({
    filename: document.filename,
    mimeType: document.mediaType,
    showPreviewToggle,
    sizeBytes: document.sizeBytes,
  });
  const language = artifactCodeLanguage(document.filename);
  const downloadLabel = downloadActionLabel(document.mediaType);
  const artifactRef = toArtifactRef(document);

  const { loading, error, content, setContent } =
    useKnowledgeDocumentPreviewContent({
      document,
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

  function buildPanelBody(
    loadingOverride?: boolean,
    mode: ArtifactPreviewMode = previewMode
  ) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifactRef}
        canPreview={canPreview}
        content={content}
        error={error}
        format={isMarkdown ? "markdown" : "plain"}
        kind="text"
        language={language}
        loading={loadingOverride ?? loading}
        previewMode={mode}
      />
    );
  }

  function buildPanelConfig(mode: ArtifactPreviewMode = previewMode) {
    return {
      bodyClassName: artifactPanelBodyClassName({
        isHtml: false,
        isImage: false,
        isMarkdown,
        previewMode: mode,
      }),
      content: buildPanelBody(undefined, mode),
      fullscreen,
      headerActions: (
        <ArtifactAttachmentPanelActions
          additionalMenuItems={null}
          content={content}
          copied={copied}
          downloadLabel={downloadLabel}
          downloadUrl={downloadUrl}
          filename={document.filename}
          fullscreen={fullscreen}
          loading={loading}
          onCopy={() => void copyDocument()}
          onToggleFullscreen={() => setFullscreen((current) => !current)}
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
    document,
    fullscreen,
    isMarkdown,
    language,
    loading,
    error,
    content,
    canPreview,
    copied,
    downloadLabel,
    downloadUrl,
    previewMode,
    showPreviewToggle,
    header.subtitle,
    header.title,
    header.typeLabel,
  ]);

  async function copyDocument() {
    try {
      let text = content;
      if (!text) {
        const result = await client.readKnowledgeBaseDocumentContent(
          profileId,
          document.id,
          { inline: true, render: "text" }
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

  function openPanel() {
    setFullscreen(false);
    setCopied(false);
    setPreviewMode("preview");
    show({
      ...buildPanelConfig("preview"),
      content: buildPanelBody(
        canPreview && content === null && error === null,
        "preview"
      ),
      defaultWidth: artifactPanelDefaultWidth(
        document.filename,
        document.mediaType
      ),
      fullscreen: false,
      id,
      onClose: () => {
        setFullscreen(false);
        setCopied(false);
        setPreviewMode("preview");
      },
      resizable: true,
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`View ${document.filename}`}
            className={className}
            disabled={!canPreview}
            onClick={openPanel}
            size="icon-sm"
            title="View"
            type="button"
            variant="ghost"
          >
            <ViewIcon aria-hidden className="size-4" />
          </Button>
        }
      />
      <TooltipContent side="top" sideOffset={8}>
        {canPreview ? "View" : "Preview unavailable"}
      </TooltipContent>
    </Tooltip>
  );
}
