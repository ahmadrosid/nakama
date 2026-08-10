import type { KeyboardEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  type AgentWorkTab,
  agentWorkTabFromSearchParams,
} from "@/lib/navigation";

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
      className="flex items-center gap-1"
      role="tablist"
    >
      <TabButton
        active={activeTab === "automations"}
        onClick={() => selectTab("automations")}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            selectTab("tasks");
            document.getElementById("agent-work-tab-tasks")?.focus();
          }
        }}
        tab="automations"
      >
        Automations
      </TabButton>
      <TabButton
        active={activeTab === "tasks"}
        onClick={() => selectTab("tasks")}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectTab("automations");
            document.getElementById("agent-work-tab-automations")?.focus();
          }
        }}
        tab="tasks"
      >
        Tasks
      </TabButton>
    </div>
  );
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
      className={`rounded-md px-3 py-1.5 font-medium text-sm transition-colors hover:bg-muted ${
        active ? "bg-muted text-foreground" : "text-muted-foreground"
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
