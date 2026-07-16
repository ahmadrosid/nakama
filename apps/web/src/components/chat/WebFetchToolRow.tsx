import { useEffect, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const siteStates = useWebSourceSiteStates(state.sources.length, state.status);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }

    setOpen(false);
  }, [isRunning]);

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
        onOpenChange={setOpen}
      />
    </div>
  );
}
