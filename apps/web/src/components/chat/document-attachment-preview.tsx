import { cn } from "@nakama/ui/utils";
import { File01Icon } from "hugeicons-react";
import { useEffect, useId, useState } from "react";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";

interface DocumentAttachmentPreviewProps {
  contentUrl?: string;
  filename: string;
  mediaType: string;
}

type PreviewKind = "image" | "pdf" | "text" | "unsupported";

function previewKind(mediaType: string): PreviewKind {
  const base = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (base.startsWith("image/")) {
    return "image";
  }

  if (base === "application/pdf") {
    return "pdf";
  }

  if (base.startsWith("text/")) {
    return "text";
  }

  return "unsupported";
}

/** Text beyond this is cut in the panel; the download link keeps the rest. */
const MAX_TEXT_PREVIEW_CHARS = 500_000;

function TextPanelContent({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; text: string; truncated: boolean }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Preview failed: ${response.status}`);
        }

        return response.text();
      })
      .then((text) => {
        if (cancelled) {
          return;
        }

        setState({
          status: "ready",
          text:
            text.length > MAX_TEXT_PREVIEW_CHARS
              ? text.slice(0, MAX_TEXT_PREVIEW_CHARS)
              : text,
          truncated: text.length > MAX_TEXT_PREVIEW_CHARS,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.status === "loading") {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-foreground text-sm">
          Couldn&apos;t load a preview of this file.
        </p>
        <a
          className="text-foreground text-sm underline"
          download={filename}
          href={url}
        >
          Download {filename}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <pre className="whitespace-pre-wrap break-words text-foreground text-sm">
        {state.text}
      </pre>
      {state.truncated ? (
        <p className="text-muted-foreground text-xs">
          Preview truncated. Download the file for the full content.
        </p>
      ) : null}
    </div>
  );
}

function PanelContent({
  filename,
  kind,
  url,
}: {
  filename: string;
  kind: PreviewKind;
  url: string;
}) {
  if (kind === "image") {
    return (
      <img
        alt=""
        className="max-h-[min(50vh,28rem)] w-full rounded-lg border border-border object-contain"
        src={url}
      />
    );
  }

  if (kind === "pdf") {
    return (
      <div className="space-y-2">
        <iframe
          className="h-[60vh] w-full rounded-lg border border-border"
          src={url}
          title={filename}
        />
        <a
          className="text-foreground text-sm underline"
          download={filename}
          href={url}
        >
          Download {filename}
        </a>
      </div>
    );
  }

  return <TextPanelContent filename={filename} url={url} />;
}

export function DocumentAttachmentPreview({
  contentUrl,
  filename,
  mediaType,
}: DocumentAttachmentPreviewProps) {
  const panelId = useId();
  const attachmentPanel = useOptionalChatAttachmentPanel();
  const show = attachmentPanel?.show;
  const hide = attachmentPanel?.hide;

  const kind = previewKind(mediaType);

  useEffect(() => {
    if (!hide) {
      return;
    }

    return () => {
      hide(panelId);
    };
  }, [hide, panelId]);

  const chipContent = (
    <>
      <File01Icon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate text-foreground text-sm">{filename}</span>
    </>
  );

  // Without a fetchable URL there is nothing to open or download.
  if (!contentUrl) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
        {chipContent}
      </div>
    );
  }

  // Unsupported types never get a content preview: icon, filename, and a
  // working download link instead.
  if (kind === "unsupported") {
    return (
      <a
        className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 transition-colors hover:bg-muted/70"
        download={filename}
        href={contentUrl}
      >
        {chipContent}
      </a>
    );
  }

  if (!show) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
        {chipContent}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-left transition-colors hover:bg-muted/70"
      )}
      onClick={() =>
        show({
          content: (
            <PanelContent filename={filename} kind={kind} url={contentUrl} />
          ),
          id: panelId,
          title: filename,
        })
      }
      type="button"
    >
      {chipContent}
    </button>
  );
}
