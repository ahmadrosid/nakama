import { useEffect, useMemo, useRef } from "react";
import { ArtifactAttachmentPanelBody } from "@/components/chat/artifact-attachment-panel-body";
import { artifactPanelDefaultWidth, artifactPanelSubtitle } from "@/components/chat/artifact-attachment-panel-body.shared";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  findCompletedContentArtifact,
  findLatestStreamingArtifact,
} from "@/lib/chat-stream-artifact";
import {
  artifactCodeLanguage,
  inferArtifactMimeType,
  isDocxFile,
  isHtmlArtifactMimeType,
  isLegacyDocFile,
  isMarkdownArtifactMimeType,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import type { ChatListItem } from "@/lib/chat-history";
import { client, formatError } from "@/lib/client";

interface EligibleStreamTarget {
  toolCallId: string;
  relativePath: string;
  tool: string;
}

function buildStreamingArtifactRef(
  filename: string,
  relativePath: string,
  tool: string,
): ChatArtifactRef {
  return {
    filename,
    path: relativePath,
    mimeType:
      tool === "write_docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : inferArtifactMimeType(filename),
    sizeBytes: 0,
    savedAt: "",
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
    isDocxFile(artifact.filename, mimeType) || isLegacyDocFile(artifact.filename, mimeType);
  const isHtml = isHtmlArtifactMimeType(mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;
  const language = artifactCodeLanguage(artifact.filename);

  return (
    <ArtifactAttachmentPanelBody
      kind="text"
      format={isMarkdown && !isHtml ? "markdown" : "plain"}
      language={language}
      loading={false}
      error={null}
      content={content || null}
      canPreview
      artifact={artifact}
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
    isDocxFile(artifact.filename, mimeType) || isLegacyDocFile(artifact.filename, mimeType);
  const isMarkdown = isMarkdownArtifactMimeType(mimeType) || isWordDocument;

  if (isHtmlArtifactMimeType(mimeType)) {
    return (
      <ArtifactAttachmentPanelBody
        kind="html"
        loading={false}
        error={null}
        content={content}
        canPreview
        artifact={artifact}
      />
    );
  }

  return (
    <ArtifactAttachmentPanelBody
      kind="text"
      format={isMarkdown ? "markdown" : "plain"}
      language={artifactCodeLanguage(artifact.filename)}
      loading={false}
      error={null}
      content={content}
      canPreview
      artifact={artifact}
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
  const streaming = useMemo(() => findLatestStreamingArtifact(messages), [messages]);

  useEffect(() => {
    if (streaming?.parsed.eligible && streaming.parsed.relativePath) {
      lastEligibleRef.current = {
        toolCallId: streaming.toolCallId,
        relativePath: streaming.parsed.relativePath,
        tool: streaming.tool,
      };
    }
  }, [streaming]);

  useEffect(() => {
    if (!profileId || !streaming?.parsed.eligible || !streaming.parsed.relativePath) {
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
      streaming.tool,
    );
    const body = buildStreamingPanelBody({
      artifact,
      content: streaming.parsed.content ?? "",
    });
    const defaultWidth = artifactPanelDefaultWidth(artifact.filename, artifact.mimeType);
    const subtitle = artifactPanelSubtitle({
      mimeType: artifact.mimeType,
      streaming: true,
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
        title: filename,
        subtitle,
        content: body,
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
      id: panelId,
      title: filename,
      subtitle,
      defaultWidth,
      resizable: true,
      fullscreen: false,
      content: body,
      onClose: () => {
        dismissedRef.current.add(panelId);
        openedRef.current = null;
      },
    });
  }, [activeId, profileId, show, streaming, update]);

  const handoffTarget = useMemo(() => {
    const candidate = lastEligibleRef.current;

    if (!candidate || dismissedRef.current.has(candidate.toolCallId)) {
      return null;
    }

    if (activeId !== candidate.toolCallId && openedRef.current !== candidate.toolCallId) {
      return null;
    }

    return findCompletedContentArtifact(messages, candidate.toolCallId);
  }, [activeId, messages]);

  useEffect(() => {
    if (!profileId || !handoffTarget) {
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
        const filename = handoffTarget.relativePath.split("/").pop() ?? handoffTarget.relativePath;
        const artifact = buildStreamingArtifactRef(
          filename,
          handoffTarget.relativePath,
          handoffTarget.tool,
        );
        const isHtml = isHtmlArtifactMimeType(artifact.mimeType);

        update(handoffTarget.toolCallId, {
          title: filename,
          subtitle: artifactPanelSubtitle({
            mimeType: artifact.mimeType,
            sizeBytes: new TextEncoder().encode(text).byteLength,
          }),
          defaultWidth: artifactPanelDefaultWidth(artifact.filename, artifact.mimeType),
          bodyClassName: isHtml ? "flex flex-col overflow-hidden p-0" : undefined,
          content: buildStablePanelBody({
            artifact,
            content: text,
          }),
        });
      })
      .catch((error) => {
        if (cancelled || activeId !== handoffTarget.toolCallId) {
          return;
        }

        update(handoffTarget.toolCallId, {
          content: (
            <p className="p-4 text-sm text-destructive">{formatError(error)}</p>
          ),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeId, handoffTarget, profileId, update]);

  return null;
}
