import { useState } from "react";
import { useWebSourceSiteStates } from "@/components/chat/use-web-source-site-states";
import { WebSourceCard } from "@/components/chat/WebSearch";
import type { ChatListItem } from "@/lib/chat-history";
import {
  buildWebFetchToolState,
  shouldRenderWebFetchToolRow,
} from "@/lib/chat-stream-web-fetch";

export function WebFetchToolRow({ message }: { message: ChatListItem }) {
  const state = buildWebFetchToolState(message);
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

  if (!shouldRenderWebFetchToolRow(message)) {
    return null;
  }

  return (
    <div className="w-full max-w-full">
      <WebSourceCard
        headerText={state.headerText ?? "page"}
        isComplete={!isRunning}
        mode="fetch"
        onOpenChange={(nextOpen) => {
          if (isRunning) {
            setCollapsedWhileRunning(!nextOpen);
          }
        }}
        open={open}
        siteStates={siteStates}
        sources={state.sources}
      />
    </div>
  );
}
