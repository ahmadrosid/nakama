import type { KeyboardEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  type AgentWorkTab,
  agentWorkTabFromSearchParams,
} from "@/lib/navigation";

const TAB_ORDER: AgentWorkTab[] = ["automations", "workflows"];

export function AgentWorkTabs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = agentWorkTabFromSearchParams(searchParams);

  function selectTab(tab: AgentWorkTab) {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (tab === "automations") {
      nextSearchParams.delete("tab");
    } else {
      nextSearchParams.set("tab", tab);
    }
    setSearchParams(nextSearchParams);
  }

  return (
    <div
      aria-label="Agent work views"
      className="flex h-full min-w-0 items-stretch"
      role="tablist"
    >
      {TAB_ORDER.map((tab) => (
        <TabButton
          active={activeTab === tab}
          key={tab}
          onClick={() => selectTab(tab)}
          onKeyDown={(event) => handleArrowNavigation(event, tab, selectTab)}
          tab={tab}
        >
          {tabLabel(tab)}
        </TabButton>
      ))}
    </div>
  );
}

function tabLabel(tab: AgentWorkTab): string {
  return tab === "workflows" ? "Workflows" : "Automations";
}

function handleArrowNavigation(
  event: KeyboardEvent<HTMLButtonElement>,
  tab: AgentWorkTab,
  selectTab: (tab: AgentWorkTab) => void
) {
  const index = TAB_ORDER.indexOf(tab);
  if (event.key === "ArrowRight" && index < TAB_ORDER.length - 1) {
    event.preventDefault();
    const next = TAB_ORDER[index + 1]!;
    selectTab(next);
    document.getElementById(`agent-work-tab-${next}`)?.focus();
  }
  if (event.key === "ArrowLeft" && index > 0) {
    event.preventDefault();
    const previous = TAB_ORDER[index - 1]!;
    selectTab(previous);
    document.getElementById(`agent-work-tab-${previous}`)?.focus();
  }
}

function TabButton({
  active,
  children,
  onClick,
  onKeyDown,
  tab,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  tab: AgentWorkTab;
}) {
  return (
    <button
      aria-controls={`agent-work-panel-${tab}`}
      aria-selected={active}
      className={`relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 font-medium text-sm transition-colors sm:px-4 ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
      id={`agent-work-tab-${tab}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}
