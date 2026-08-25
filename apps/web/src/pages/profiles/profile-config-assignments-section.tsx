import { BASH_TOOL_ID } from "@nakama/core/tools/protected";
import { useAppNavigation } from "@/hooks/use-app-navigation";
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
    <>
      <ProfileToolsSection
        availableTools={availableTools}
        busy={readOnly}
        detail={detail}
        onAssign={handleAssignTool}
        onRemove={setRemoveConfirm}
      />
      <ProfileMcpSection
        allMcpServers={allMcpServers}
        busy={readOnly}
        detail={detail}
        onCreateOpen={() => setMcpCreateOpen(true)}
        onRemove={setRemoveConfirm}
      />
      <ProfileComposioSection
        assignedComposioToolkits={assignedComposioToolkits}
        availableComposioToolkits={availableComposioToolkits}
        busy={readOnly}
        composioToolkitsData={composioToolkitsData}
        onAssign={handleAssignComposioToolkit}
        onRemove={setRemoveConfirm}
      />
      <ProfileSkillsSection
        allSkills={allSkills}
        assignedSkillIds={assignedSkillIds}
        busy={readOnly}
        detail={detail}
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
    </>
  );
}
