import { useMemo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { languageFromSourcePath } from "@/components/tools/tool-source-code-block.shared";

function buildFencedCode(content: string, language: string): string {
  let fence = "```";

  while (content.includes(fence)) {
    fence += "`";
  }

  return `${fence}${language}\n${content}\n${fence}`;
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
