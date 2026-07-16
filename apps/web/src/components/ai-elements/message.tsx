"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "@/context/use-theme";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm leading-[1.55] tracking-[0.01em]",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

const MessageResponseBody = memo(
  ({
    className,
    lineNumbers = false,
    controls = { code: { copy: true, download: false } },
    shikiTheme,
    ...props
  }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "chat-markdown size-full text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      controls={controls}
      lineNumbers={lineNumbers}
      plugins={streamdownPlugins}
      shikiTheme={shikiTheme}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === nextProps.isAnimating &&
    prevProps.shikiTheme === nextProps.shikiTheme,
);

MessageResponseBody.displayName = "MessageResponseBody";

export function MessageResponse(props: MessageResponseProps) {
  const { resolvedTheme } = useTheme();
  const shikiTheme =
    props.shikiTheme ??
    (resolvedTheme === "dark"
      ? (["github-dark", "github-dark"] as const)
      : (["github-light", "github-light"] as const));

  return <MessageResponseBody {...props} shikiTheme={shikiTheme} />;
}
