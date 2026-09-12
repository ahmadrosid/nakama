import { Tabs } from "@base-ui/react/tabs";
import { BASH_TOOL_ID } from "@nakama/core/tools/protected";
import { Switch } from "@nakama/ui/switch";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import {
  pluginAgentAccessState,
  useOrgPlugins,
  useSavePluginAgentAccess,
} from "@/hooks/use-plugins";
import { formatError } from "@/lib/client";
import { pluginIcon } from "@/lib/navigation";
import { ProfileComposioSection } from "@/pages/profiles/profile-composio-section";
import { ProfileMcpSection } from "@/pages/profiles/profile-mcp-section";
import { ProfileSkillsSection } from "@/pages/profiles/profile-skills-section";
import { ProfileToolsSection } from "@/pages/profiles/profile-tools-section";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

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
    allMcpServers,
    setMcpCreateOpen,
    composioToolkitsData,
    assignedComposioToolkits,
    availableComposioToolkits,
    handleAssignComposioToolkit,
    allSkills,
    assignedSkillIds,
    setSkillCreateOpen,
    setSkillInstallOpen,
    handleAssignSkill,
    handleDeleteSkill,
    selectedId,
  } = state;
  const { navigateToSkillDetail } = useAppNavigation();
  const readOnly = busy || !canManageProfile;

  if (!detail) {
    return null;
  }

  return (
    <Tabs.Root className="min-w-0 pt-5" defaultValue="tools" key={detail.id}>
      <Tabs.List
        aria-label="Profile capabilities"
        className="flex gap-4 overflow-x-auto border-border border-b"
      >
        {[
          { label: "Tools", value: "tools" },
          { label: "Plugins", value: "plugins" },
          { label: "MCP", value: "mcp" },
          { label: "Skills", value: "skills" },
          ...(composioToolkitsData?.configured
            ? [{ label: "Apps", value: "apps" }]
            : []),
        ].map(({ value, label }) => (
          <Tabs.Tab
            className="shrink-0 border-transparent border-b-2 px-1 py-3 font-medium text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[active]:border-foreground data-[active]:text-foreground"
            key={value}
            value={value}
          >
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value="tools">
        <ProfileToolsSection
          availableTools={availableTools.filter((tool) => !tool.pluginId)}
          busy={readOnly}
          detail={{
            ...detail,
            tools: detail.tools.filter((tool) => !tool.pluginId),
          }}
          onAssign={handleAssignTool}
          onRemove={setRemoveConfirm}
        />
      </Tabs.Panel>
      <Tabs.Panel value="plugins">
        <ProfilePluginsSection state={state} />
      </Tabs.Panel>
      <Tabs.Panel value="mcp">
        <ProfileMcpSection
          allMcpServers={allMcpServers}
          busy={readOnly}
          detail={detail}
          onCreateOpen={() => setMcpCreateOpen(true)}
          onRemove={setRemoveConfirm}
        />
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
      <Tabs.Panel value="skills">
        <ProfileSkillsSection
          allSkills={allSkills.filter((skill) => !skill.pluginId)}
          assignedSkillIds={assignedSkillIds}
          busy={readOnly}
          detail={{
            ...detail,
            skills: detail.skills.filter((skill) => !skill.pluginId),
          }}
          onAssign={handleAssignSkill}
          onAssignBash={() => handleAssignTool(BASH_TOOL_ID)}
          onCreateOpen={() => setSkillCreateOpen(true)}
          onDelete={handleDeleteSkill}
          onInstallOpen={() => setSkillInstallOpen(true)}
          onRemove={setRemoveConfirm}
          onViewDetail={(skillId) => {
            navigateToSkillDetail(skillId, {
              profileId: selectedId ?? undefined,
            });
          }}
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
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border empty:hidden">
        {installed.map((plugin) => {
          const access = pluginAgentAccessState(detail, plugin.pluginId, {
            skills: allSkills,
            tools: allTools,
          });
          const Icon = pluginIcon(plugin.pluginId);
          return (
            <li
              className="flex items-center gap-3 px-3 py-3"
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
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
