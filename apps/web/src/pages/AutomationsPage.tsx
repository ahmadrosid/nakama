import { AutomationsDialogs } from "@/pages/automations/automations-dialogs";
import { AutomationsPageLayout } from "@/pages/automations/automations-page-layout";
import { useAutomationsPage } from "@/pages/automations/use-automations-page";

export function AutomationsPage() {
  const state = useAutomationsPage();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AutomationsPageLayout {...state} />
      <AutomationsDialogs {...state} />
    </div>
  );
}
