import { useEffect, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const siteStates = useWebSourceSiteStates(state.sources.length, state.status);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }

    setOpen(false);
  }, [isRunning]);

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
        onOpenChange={setOpen}
      />
    </div>
  );
}
