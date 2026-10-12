import { Tabs } from "@base-ui/react/tabs";
import { Button } from "@nakama/ui/button";
import { Switch } from "@nakama/ui/switch";
import { Add01Icon } from "hugeicons-react";
import { useState } from "react";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { useAuth } from "@/context/use-auth";
import {
  pluginAgentAccessState,
  useOrgPlugins,
  useSavePluginAgentAccess,
} from "@/hooks/use-plugins";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { formatError } from "@/lib/client";
import { pluginIcon } from "@/lib/navigation";
import { ProfileComposioSection } from "@/pages/profiles/profile-composio-section";
import { ProfileToolsSection } from "@/pages/profiles/profile-tools-section";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

function ProfileCapabilityTabs({
  appsConfigured,
  isOrgAdmin,
  pendingCount,
}: {
  appsConfigured: boolean;
  isOrgAdmin: boolean;
  pendingCount: number;
}) {
  return (
    <Tabs.List
      aria-label="Profile capabilities"
      className="no-scrollbar flex min-w-0 flex-1 gap-0.5 overflow-x-auto rounded-xl bg-muted p-[3px]"
    >
      {[
        { label: "Tools", value: "tools" },
        { label: "Plugins", value: "plugins" },
        ...(appsConfigured ? [{ label: "Apps", value: "apps" }] : []),
        ...(isOrgAdmin
          ? [
              {
                label: `Proposals${pendingCount ? ` (${pendingCount})` : ""}`,
                value: "proposals",
              },
            ]
          : []),
      ].map(({ value, label }) => (
        <Tabs.Tab
          className="shrink-0 rounded-lg px-3.5 py-1.5 font-medium text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm"
          key={value}
          value={value}
        >
          {label}
        </Tabs.Tab>
      ))}
    </Tabs.List>
  );
}

export function ProfileConfigAssignmentsSection({
  state,
}: {
  state: ProfilesPageState;
}) {
  const {
    detail,
    busy,
    canManageProfile,
    availableTools,
    handleAssignTool,
    setRemoveConfirm,
    composioToolkitsData,
    assignedComposioToolkits,
    availableComposioToolkits,
    handleAssignComposioToolkit,
    selectedId,
  } = state;

  const { activeOrg } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const [capability, setCapability] = useState("tools");
  const [toolAssignOpen, setToolAssignOpen] = useState(false);

  const { data: proposals } = useSkillProposals(
    isOrgAdmin && selectedId ? activeOrg.id : null,
    { profileId: selectedId ?? undefined, status: "pending" }
  );

  const readOnly = busy || !canManageProfile;
  const toolsToAdd = availableTools.filter((tool) => !tool.pluginId);

  const activeCapability =
    isOrgAdmin && state.detailTab === "proposals" ? "proposals" : capability;

  if (!detail) {
    return null;
  }

  return (
    <Tabs.Root
      className="min-w-0"
      key={detail.id}
      onValueChange={(value) => {
        if (value !== "proposals") {
          setCapability(String(value));
        }

        state.setDetailTab(value === "proposals" ? "proposals" : "profile");
      }}
      value={activeCapability}
    >
      <div className="flex items-center gap-2">
        <ProfileCapabilityTabs
          appsConfigured={composioToolkitsData?.configured === true}
          isOrgAdmin={isOrgAdmin}
          pendingCount={proposals?.pendingCount ?? 0}
        />
        {activeCapability === "tools" && toolsToAdd.length > 0 ? (
          <Button
            aria-label="Add tool"
            className="shrink-0"
            disabled={readOnly}
            onClick={() => setToolAssignOpen(true)}
            size="icon"
            type="button"
            variant="outline"
          >
            <Add01Icon aria-hidden className="size-4" />
          </Button>
        ) : null}
        <ToolAssignDialog
          disabled={readOnly}
          groupPlugins
          hideTrigger
          onAssign={handleAssignTool}
          onOpenChange={setToolAssignOpen}
          open={toolAssignOpen && canManageProfile}
          tools={toolsToAdd}
        />
      </div>
      {isOrgAdmin && activeOrg ? (
        <Tabs.Panel className="pt-5" value="proposals">
          <SkillProposalsPanel orgId={activeOrg.id} profileId={detail.id} />
        </Tabs.Panel>
      ) : null}
      <Tabs.Panel value="tools">
        <ProfileToolsSection
          busy={readOnly}
          detail={{
            ...detail,
            tools: detail.tools.filter((tool) => !tool.pluginId),
          }}
          onRemove={setRemoveConfirm}
        />
      </Tabs.Panel>
      <Tabs.Panel value="plugins">
        <ProfilePluginsSection state={state} />
      </Tabs.Panel>
      <Tabs.Panel value="apps">
        <ProfileComposioSection
          assignedComposioToolkits={assignedComposioToolkits}
          availableComposioToolkits={availableComposioToolkits}
          busy={readOnly}
          composioToolkitsData={composioToolkitsData}
          onAssign={handleAssignComposioToolkit}
          onRemove={setRemoveConfirm}
        />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function ProfilePluginsSection({ state }: { state: ProfilesPageState }) {
  const plugins = useOrgPlugins();
  const save = useSavePluginAgentAccess();
  const { detail, allTools, allSkills, busy, canManageProfile } = state;

  if (!detail) {
    return null;
  }

  if (plugins.isLoading) {
    return (
      <p className="py-5 text-muted-foreground text-sm">Loading plugins…</p>
    );
  }

  if (plugins.error) {
    return (
      <p className="py-5 text-destructive text-sm" role="alert">
        {formatError(plugins.error)}
      </p>
    );
  }

  const installed = (plugins.data ?? []).filter((plugin) => plugin.installed);

  return (
    <div className="pt-5">
      {save.error ? (
        <p className="mb-4 text-destructive text-sm" role="alert">
          {formatError(save.error)}
        </p>
      ) : null}
      {installed.length === 0 ? (
        <p className="text-muted-foreground text-sm">No plugins installed.</p>
      ) : null}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card empty:hidden">
        {installed.map((plugin) => {
          const access = pluginAgentAccessState(detail, plugin.pluginId, {
            skills: allSkills,
            tools: allTools,
          });

          const Icon = pluginIcon(plugin.pluginId);

          return (
            <li
              className="flex items-center gap-3 px-4 py-3"
              key={plugin.pluginId}
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{plugin.name}</p>
                {plugin.lifecycleState === "enabled" ? null : (
                  <p className="text-muted-foreground text-xs">
                    Disabled in this organization
                  </p>
                )}
                {access.assigned > 0 && !access.full ? (
                  <p className="text-muted-foreground text-xs">
                    Partially enabled
                  </p>
                ) : null}
              </div>
              <Switch
                aria-label={`Enable ${plugin.name} for ${detail.name}`}
                checked={access.full}
                disabled={
                  busy ||
                  !canManageProfile ||
                  save.isPending ||
                  plugin.lifecycleState !== "enabled" ||
                  access.total === 0
                }
                onCheckedChange={(checked) =>
                  save.mutate({
                    changes: { [detail.id]: checked },
                    pluginId: plugin.pluginId,
                  })
                }
                size="sm"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
