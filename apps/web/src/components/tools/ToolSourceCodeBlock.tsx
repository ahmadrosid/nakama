import { useMemo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";

function buildFencedCode(content: string, language: string): string {
  let fence = "```";

  while (content.includes(fence)) {
    fence += "`";
  }

  return `${fence}${language}\n${content}\n${fence}`;
}

export function languageFromSourcePath(path: string): string {
  const dot = path.lastIndexOf(".");

  if (dot === -1) {
    return "javascript";
  }

  switch (path.slice(dot)) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
      return "javascript";
    case ".jsx":
      return "jsx";
    case ".json":
      return "json";
    default:
      return "javascript";
  }
}

export function ToolSourceCodeBlock({
  content,
  path,
}: {
  content: string;
  path?: string;
}) {
  const markdown = useMemo(
    () => buildFencedCode(content, languageFromSourcePath(path ?? "")),
    [content, path],
  );

  return (
    <MessageResponse
      lineNumbers
      className="max-w-none [&_[data-streamdown=code-block-body]]:max-h-[min(60vh,32rem)] [&_[data-streamdown=code-block-body]]:overflow-auto"
    >
      {markdown}
    </MessageResponse>
  );
}
