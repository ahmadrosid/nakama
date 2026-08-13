import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactCanTogglePreviewSource,
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelHeaderMeta,
} from "@/components/chat/artifact-attachment-panel-body.shared";
import {
  type ArtifactPreviewMode,
  ArtifactPreviewModeToggle,
} from "@/components/chat/artifact-preview-mode-toggle";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  artifactCodeLanguage,
  type ChatArtifactRef,
  inferArtifactMimeType,
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
} from "@/lib/chat-artifacts";
import type { ChatListItem } from "@/lib/chat-history";
import {
  findCompletedContentArtifact,
  findLatestStreamingArtifact,
} from "@/lib/chat-stream-artifact";
import { client, formatError } from "@/lib/client";

interface EligibleStreamTarget {
  relativePath: string;
  tool: string;
  toolCallId: string;
}

function buildStreamingArtifactRef(
  filename: string,
  relativePath: string,
  tool: string
): ChatArtifactRef {
  return {
    filename,
    mimeType:
      tool === "write_docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : inferArtifactMimeType(filename),
    path: relativePath,
    savedAt: "",
    sizeBytes: 0,
  };
}

function streamingPreviewFlags(artifact: ChatArtifactRef) {
  const mimeType = artifact.mimeType;
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  return { isHtml, isMarkdown, isWordDocument, mimeType };
}

function buildStreamingArtifactHeader(
  artifact: ChatArtifactRef,
  options: { sizeBytes?: number; streaming?: boolean } = {}
) {
  const { isHtml, isMarkdown, mimeType } = streamingPreviewFlags(artifact);
  const showPreviewToggle = artifactCanTogglePreviewSource({
    isHtml,
    isMarkdown,
  });
  return {
    ...artifactPanelHeaderMeta({
      filename: artifact.filename,
      mimeType,
      showPreviewToggle,
      sizeBytes: options.sizeBytes,
      streaming: options.streaming,
    }),
    showPreviewToggle,
  };
}

function buildStreamingPanelBody({
  artifact,
  content,
  previewMode,
}: {
  artifact: ChatArtifactRef;
  content: string;
  previewMode: ArtifactPreviewMode;
}) {
  const { isHtml, isMarkdown } = streamingPreviewFlags(artifact);
  const language = artifactCodeLanguage(artifact.filename);

  return (
    <ArtifactAttachmentPanelBody
      artifact={artifact}
      canPreview
      content={content || null}
      error={null}
      format={isMarkdown && !isHtml ? "markdown" : "plain"}
      kind="text"
      language={language}
      loading={false}
      previewMode={previewMode}
      streaming
    />
  );
}

function buildStablePanelBody({
  artifact,
  content,
  previewMode,
}: {
  artifact: ChatArtifactRef;
  content: string;
  previewMode: ArtifactPreviewMode;
}) {
  const { isHtml, isMarkdown } = streamingPreviewFlags(artifact);

  if (isHtml) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview
        content={content}
        error={null}
        kind="html"
        loading={false}
        previewMode={previewMode}
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      artifact={artifact}
      canPreview
      content={content}
      error={null}
      format={isMarkdown ? "markdown" : "plain"}
      kind="text"
      language={artifactCodeLanguage(artifact.filename)}
      loading={false}
      previewMode={previewMode}
    />
  );
}

function withPanelPreviewMode(
  current: Partial<Record<string, ArtifactPreviewMode>>,
  panelId: string,
  mode: ArtifactPreviewMode
): Partial<Record<string, ArtifactPreviewMode>> {
  if (current[panelId] === mode) {
    return current;
  }
  return { ...current, [panelId]: mode };
}

function withoutPanelPreviewMode(
  current: Partial<Record<string, ArtifactPreviewMode>>,
  panelId: string
): Partial<Record<string, ArtifactPreviewMode>> {
  if (!(panelId in current)) {
    return current;
  }
  const next = { ...current };
  delete next[panelId];
  return next;
}

export function ArtifactStreamingPanelBridge({
  messages,
  profileId,
}: {
  messages: ChatListItem[];
  profileId?: string | null;
}) {
  const { show, update, activeId } = useChatAttachmentPanel();
  const dismissedRef = useRef(new Set<string>());
  const openedRef = useRef<string | null>(null);
  const lastEligibleRef = useRef<EligibleStreamTarget | null>(null);
  const handedOffRef = useRef(new Set<string>());
  const autoWidthAppliedRef = useRef(new Set<string>());
  const [previewModeByPanel, setPreviewModeByPanel] = useState<
    Partial<Record<string, ArtifactPreviewMode>>
  >({});
  const [stableContent, setStableContent] = useState<{
    artifact: ChatArtifactRef;
    content: string;
    toolCallId: string;
  } | null>(null);
  const streaming = useMemo(
    () => findLatestStreamingArtifact(messages),
    [messages]
  );

  useEffect(() => {
    if (streaming?.parsed.eligible && streaming.parsed.relativePath) {
      lastEligibleRef.current = {
        relativePath: streaming.parsed.relativePath,
        tool: streaming.tool,
        toolCallId: streaming.toolCallId,
      };
    }
  }, [streaming]);

  useEffect(() => {
    if (
      !(
        profileId &&
        streaming?.parsed.eligible &&
        streaming.parsed.relativePath
      )
    ) {
      return;
    }

    const panelId = streaming.toolCallId;
    const previewMode = previewModeByPanel[panelId] ?? "preview";

    if (dismissedRef.current.has(panelId)) {
      return;
    }

    const filename = streaming.parsed.filename ?? "Writing artifact…";
    const artifact = buildStreamingArtifactRef(
      filename,
      streaming.parsed.relativePath,
      streaming.tool
    );
    const body = buildStreamingPanelBody({
      artifact,
      content: streaming.parsed.content ?? "",
      previewMode,
    });
    const defaultWidth = artifactPanelDefaultWidth(
      artifact.filename,
      artifact.mimeType
    );
    const header = buildStreamingArtifactHeader(artifact, { streaming: true });
    const { isHtml, isMarkdown } = streamingPreviewFlags(artifact);
    const bodyClassName = artifactPanelBodyClassName({
      isHtml,
      isImage: false,
      isMarkdown,
      previewMode,
    });
    const leading = header.showPreviewToggle ? (
      <ArtifactPreviewModeToggle
        mode={previewMode}
        onChange={(mode) =>
          setPreviewModeByPanel((current) =>
            withPanelPreviewMode(current, panelId, mode)
          )
        }
      />
    ) : null;
    const widthPatch =
      defaultWidth === 768 && !autoWidthAppliedRef.current.has(panelId)
        ? { defaultWidth }
        : {};

    if (defaultWidth === 768) {
      autoWidthAppliedRef.current.add(panelId);
    }

    if (activeId === panelId) {
      update(panelId, {
        bodyClassName,
        content: body,
        leading,
        subtitle: header.subtitle,
        title: header.title,
        typeLabel: header.typeLabel,
        ...widthPatch,
      });
      return;
    }

    if (openedRef.current === panelId) {
      return;
    }

    openedRef.current = panelId;
    if (defaultWidth === 768) {
      autoWidthAppliedRef.current.add(panelId);
    }
    show({
      bodyClassName: artifactPanelBodyClassName({
        isHtml,
        isImage: false,
        isMarkdown,
        previewMode: "preview",
      }),
      content: buildStreamingPanelBody({
        artifact,
        content: streaming.parsed.content ?? "",
        previewMode: "preview",
      }),
      defaultWidth,
      fullscreen: false,
      id: panelId,
      leading: header.showPreviewToggle ? (
        <ArtifactPreviewModeToggle
          mode="preview"
          onChange={(mode) =>
            setPreviewModeByPanel((current) =>
              withPanelPreviewMode(current, panelId, mode)
            )
          }
        />
      ) : null,
      onClose: () => {
        dismissedRef.current.add(panelId);
        openedRef.current = null;
        setPreviewModeByPanel((current) =>
          withoutPanelPreviewMode(current, panelId)
        );
      },
      resizable: true,
      subtitle: header.subtitle,
      title: header.title,
      typeLabel: header.typeLabel,
    });
  }, [activeId, previewModeByPanel, profileId, show, streaming, update]);

  const handoffTarget = useMemo(() => {
    const candidate = lastEligibleRef.current;

    if (!candidate || dismissedRef.current.has(candidate.toolCallId)) {
      return null;
    }

    if (
      activeId !== candidate.toolCallId &&
      openedRef.current !== candidate.toolCallId
    ) {
      return null;
    }

    return findCompletedContentArtifact(messages, candidate.toolCallId);
  }, [activeId, messages]);

  useEffect(() => {
    if (!(profileId && handoffTarget)) {
      return;
    }

    if (handedOffRef.current.has(handoffTarget.toolCallId)) {
      return;
    }

    handedOffRef.current.add(handoffTarget.toolCallId);

    let cancelled = false;

    void client
      .readProfileArtifactContent(profileId, handoffTarget.relativePath, {
        inline: true,
        render: handoffTarget.tool === "write_docx" ? "markdown" : undefined,
      })
      .then((response) => {
        if (cancelled || activeId !== handoffTarget.toolCallId) {
          return;
        }

        const text = new TextDecoder().decode(response.data);
        const filename =
          handoffTarget.relativePath.split("/").pop() ??
          handoffTarget.relativePath;
        const artifact = buildStreamingArtifactRef(
          filename,
          handoffTarget.relativePath,
          handoffTarget.tool
        );
        setStableContent({
          artifact,
          content: text,
          toolCallId: handoffTarget.toolCallId,
        });
      })
      .catch((error) => {
        if (cancelled || activeId !== handoffTarget.toolCallId) {
          return;
        }

        update(handoffTarget.toolCallId, {
          content: (
            <p className="p-4 text-destructive text-sm">{formatError(error)}</p>
          ),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeId, handoffTarget, profileId, update]);

  useEffect(() => {
    if (!stableContent || activeId !== stableContent.toolCallId) {
      return;
    }

    const previewMode =
      previewModeByPanel[stableContent.toolCallId] ?? "preview";
    const header = buildStreamingArtifactHeader(stableContent.artifact, {
      sizeBytes: new TextEncoder().encode(stableContent.content).byteLength,
    });
    const { isHtml, isMarkdown } = streamingPreviewFlags(
      stableContent.artifact
    );

    update(stableContent.toolCallId, {
      bodyClassName: artifactPanelBodyClassName({
        isHtml,
        isImage: false,
        isMarkdown,
        previewMode,
      }),
      content: buildStablePanelBody({
        artifact: stableContent.artifact,
        content: stableContent.content,
        previewMode,
      }),
      defaultWidth: artifactPanelDefaultWidth(
        stableContent.artifact.filename,
        stableContent.artifact.mimeType
      ),
      leading: header.showPreviewToggle ? (
        <ArtifactPreviewModeToggle
          mode={previewMode}
          onChange={(mode) =>
            setPreviewModeByPanel((current) =>
              withPanelPreviewMode(current, stableContent.toolCallId, mode)
            )
          }
        />
      ) : null,
      subtitle: header.subtitle,
      title: header.title,
      typeLabel: header.typeLabel,
    });
  }, [activeId, previewModeByPanel, stableContent, update]);

  return null;
}
