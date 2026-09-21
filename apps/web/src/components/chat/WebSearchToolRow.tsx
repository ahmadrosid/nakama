import { useState } from "react";
import { useWebSourceSiteStates } from "@/components/chat/use-web-source-site-states";
import { WebSourceCard } from "@/components/chat/WebSearch";
import type { ChatListItem } from "@/lib/chat-history";
import {
  buildWebSearchToolState,
  shouldRenderWebSearchToolRow,
} from "@/lib/chat-stream-web-search";

export function WebSearchToolRow({ message }: { message: ChatListItem }) {
  const state = buildWebSearchToolState(message);
  const isRunning = state.status === "running";
  const [open, setOpen] = useState(isRunning);
  const [prevIsRunning, setPrevIsRunning] = useState(isRunning);

  if (isRunning !== prevIsRunning) {
    setPrevIsRunning(isRunning);
    setOpen(isRunning);
  }

  const siteStates = useWebSourceSiteStates(state.sources.length, state.status);

  if (!shouldRenderWebSearchToolRow(message)) {
    return null;
  }

  return (
    <div className="w-full max-w-full">
      <WebSourceCard
        headerText={state.query ?? "the web"}
        isComplete={!isRunning}
        mode="search"
        onOpenChange={setOpen}
        open={open}
        siteStates={siteStates}
        sources={state.sources}
      />
    </div>
  );
}
