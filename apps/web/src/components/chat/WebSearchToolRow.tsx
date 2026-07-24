import { useState } from "react";
import type { ChatListItem } from "@/lib/chat-history";
import { WebSourceCard } from "@/components/chat/WebSearch";
import { useWebSourceSiteStates } from "@/components/chat/use-web-source-site-states";
import {
  buildWebSearchToolState,
  shouldRenderWebSearchToolRow,
} from "@/lib/chat-stream-web-search";

export function WebSearchToolRow({ message }: { message: ChatListItem }) {
  const state = buildWebSearchToolState(message);
  const isRunning = state.status === "running";
  const [collapsedWhileRunning, setCollapsedWhileRunning] = useState(false);
  const [prevIsRunning, setPrevIsRunning] = useState(isRunning);

  if (isRunning !== prevIsRunning) {
    setPrevIsRunning(isRunning);
    if (isRunning) {
      setCollapsedWhileRunning(false);
    }
  }

  const open = isRunning ? !collapsedWhileRunning : false;
  const siteStates = useWebSourceSiteStates(state.sources.length, state.status);

  if (!shouldRenderWebSearchToolRow(message)) {
    return null;
  }

  return (
    <div className="w-full max-w-full">
      <WebSourceCard
        mode="search"
        headerText={state.query ?? "the web"}
        sources={state.sources}
        siteStates={siteStates}
        isComplete={!isRunning}
        open={open}
        onOpenChange={(nextOpen) => {
          if (isRunning) {
            setCollapsedWhileRunning(!nextOpen);
          }
        }}
      />
    </div>
  );
}
