import { useSearchParams } from "react-router-dom";
import { agentWorkTabFromSearchParams } from "@/lib/navigation";
import { AutomationsDialogs } from "@/pages/automations/automations-dialogs";
import { agentWorkPanelClassName } from "@/pages/automations/automations-page.shared";
import { AutomationsPageLayout } from "@/pages/automations/automations-page-layout";
import { useAutomationsPage } from "@/pages/automations/use-automations-page";
import { WorkflowsPage } from "@/pages/workflows/WorkflowsPage";

export function AutomationsPage() {
  const state = useAutomationsPage();
  const [searchParams] = useSearchParams();
  const activeTab = agentWorkTabFromSearchParams(searchParams);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {activeTab === "automations" ? (
        <div
          aria-labelledby="agent-work-tab-automations"
          className={agentWorkPanelClassName}
          id="agent-work-panel-automations"
          role="tabpanel"
        >
          <AutomationsPageLayout {...state} />
        </div>
      ) : (
        <div
          aria-labelledby="agent-work-tab-workflows"
          className={agentWorkPanelClassName}
          id="agent-work-panel-workflows"
          role="tabpanel"
        >
          <WorkflowsPage />
        </div>
      )}
      <AutomationsDialogs {...state} />
    </div>
  );
}
