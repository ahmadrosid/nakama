import { useEffect, useMemo, useRef } from "react";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import {
  artifactPanelBodyClassName,
  artifactPanelDefaultWidth,
  artifactPanelSubtitle,
} from "@/components/chat/artifact-attachment-panel-body.shared";
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

function buildStreamingPanelBody({
  artifact,
  content,
}: {
  artifact: ChatArtifactRef;
  content: string;
}) {
  const mimeType = artifact.mimeType;
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
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
      streaming
    />
  );
}

function buildStablePanelBody({
  artifact,
  content,
}: {
  artifact: ChatArtifactRef;
  content: string;
}) {
  const mimeType = artifact.mimeType;
  const isWordDocument =
    isDocxFile(artifact.filename, mimeType) ||
    isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;

  if (isHtmlArtifactMimeType(mimeType)) {
    return (
      <ArtifactAttachmentPanelBody
        artifact={artifact}
        canPreview
        content={content}
        error={null}
        kind="html"
        loading={false}
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
    />
  );
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
    });
    const defaultWidth = artifactPanelDefaultWidth(
      artifact.filename,
      artifact.mimeType
    );
    const subtitle = artifactPanelSubtitle({
      mimeType: artifact.mimeType,
      streaming: true,
    });
    const isHtml = isHtmlArtifactMimeType(artifact.mimeType);
    const isWordDocument =
      isDocxFile(artifact.filename, artifact.mimeType) ||
      isLegacyDocFile(artifact.filename, artifact.mimeType);
    const isMarkdown =
      isMarkdownArtifactMimeType(artifact.mimeType) || isWordDocument;
    const bodyClassName = artifactPanelBodyClassName({
      isHtml,
      isImage: false,
      isMarkdown,
    });
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
        subtitle,
        title: filename,
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
      bodyClassName,
      content: body,
      defaultWidth,
      fullscreen: false,
      id: panelId,
      onClose: () => {
        dismissedRef.current.add(panelId);
        openedRef.current = null;
      },
      resizable: true,
      subtitle,
      title: filename,
    });
  }, [activeId, profileId, show, streaming, update]);

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
        const isHtml = isHtmlArtifactMimeType(artifact.mimeType);
        const isWordDocument =
          isDocxFile(artifact.filename, artifact.mimeType) ||
          isLegacyDocFile(artifact.filename, artifact.mimeType);
        const isMarkdown =
          isMarkdownArtifactMimeType(artifact.mimeType) || isWordDocument;

        update(handoffTarget.toolCallId, {
          bodyClassName: artifactPanelBodyClassName({
            isHtml,
            isImage: false,
            isMarkdown,
          }),
          content: buildStablePanelBody({
            artifact,
            content: text,
          }),
          defaultWidth: artifactPanelDefaultWidth(
            artifact.filename,
            artifact.mimeType
          ),
          subtitle: artifactPanelSubtitle({
            mimeType: artifact.mimeType,
            sizeBytes: new TextEncoder().encode(text).byteLength,
          }),
          title: filename,
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

  return null;
}
