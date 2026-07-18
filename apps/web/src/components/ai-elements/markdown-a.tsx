"use client";

import { cn } from "@/lib/utils";
import { parseYoutubeVideoId } from "@/lib/youtube-url";
import {
  useCallback,
  useContext,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { StreamdownContext, type LinkSafetyModalProps } from "streamdown";

import { ExternalLinkSafetyModal } from "@/components/ai-elements/external-link-safety-modal";
import { YoutubeEmbed } from "@/components/ai-elements/youtube-embed";

type MarkdownAProps = ComponentProps<"a"> & {
  node?: unknown;
};

/** Streamdown `a` override: embed YouTube URLs, keep link-safety for everything else. */
export function MarkdownA({ href, children, className, node: _node, ...rest }: MarkdownAProps) {
  const videoId = typeof href === "string" ? parseYoutubeVideoId(href) : null;
  if (videoId) {
    return <YoutubeEmbed videoId={videoId} />;
  }

  return (
    <SafeMarkdownLink className={className} href={href} {...rest}>
      {children}
    </SafeMarkdownLink>
  );
}

function SafeMarkdownLink({
  href,
  children,
  className,
  ...rest
}: Omit<MarkdownAProps, "node">) {
  const { linkSafety } = useContext(StreamdownContext);
  const [open, setOpen] = useState(false);
  const incomplete = href === "streamdown:incomplete-link";

  const onClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      if (!linkSafety?.enabled || !href || incomplete) return;
      event.preventDefault();
      if (linkSafety.onLinkCheck && (await linkSafety.onLinkCheck(href))) {
        window.open(href, "_blank", "noreferrer");
        return;
      }
      setOpen(true);
    },
    [href, incomplete, linkSafety],
  );

  const onConfirm = useCallback(() => {
    if (href) window.open(href, "_blank", "noreferrer");
  }, [href]);

  const onClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (linkSafety?.enabled && href) {
    const modalProps: LinkSafetyModalProps = {
      url: href,
      isOpen: open,
      onClose,
      onConfirm,
    };

    return (
      <>
        <button
          className={cn(
            "wrap-anywhere appearance-none text-left font-medium text-primary underline",
            className,
          )}
          data-incomplete={incomplete || undefined}
          data-streamdown="link"
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
        {renderLinkSafetyModal(linkSafety.renderModal, modalProps)}
      </>
    );
  }

  return (
    <a
      className={cn("wrap-anywhere font-medium text-primary underline", className)}
      data-incomplete={incomplete || undefined}
      data-streamdown="link"
      href={href}
      rel="noreferrer"
      target="_blank"
      {...rest}
    >
      {children}
    </a>
  );
}

function renderLinkSafetyModal(
  renderModal: ((props: LinkSafetyModalProps) => ReactNode) | undefined,
  props: LinkSafetyModalProps,
): ReactNode {
  if (renderModal) return renderModal(props);
  return <ExternalLinkSafetyModal {...props} />;
}
