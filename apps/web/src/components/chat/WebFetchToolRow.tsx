import { useState } from "react";
import type { ChatListItem } from "@/lib/chat-history";
import { WebSourceCard } from "@/components/chat/WebSearch";
import { useWebSourceSiteStates } from "@/components/chat/use-web-source-site-states";
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
        mode="fetch"
        headerText={state.headerText ?? "page"}
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
