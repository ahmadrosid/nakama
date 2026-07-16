import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";
import { ProfileComposioSection } from "@/pages/profiles/profile-composio-section";
import { ProfileMcpSection } from "@/pages/profiles/profile-mcp-section";
import { ProfileSkillsSection } from "@/pages/profiles/profile-skills-section";
import { ProfileToolsSection } from "@/pages/profiles/profile-tools-section";

export function ProfileConfigAssignmentsSection({ state }: { state: ProfilesPageState }) {
  const {
    detail,
    busy,
    availableTools,
    handleAssignTool,
    setRemoveConfirm,
    allMcpServers,
    availableMcpServers,
    setMcpCreateOpen,
    handleAssignMcpServer,
    composioToolkitsData,
    assignedComposioToolkits,
    availableComposioToolkits,
    handleAssignComposioToolkit,
    allSkills,
    assignedSkillIds,
    setSkillCreateOpen,
    handleAssignSkill,
    handleDeleteSkill,
    setDetailSkillId,
  } = state;

  if (!detail) {
    return null;
  }

  return (
    <>
      <ProfileToolsSection
        detail={detail}
        busy={busy}
        availableTools={availableTools}
        onAssign={handleAssignTool}
        onRemove={setRemoveConfirm}
      />
      <ProfileMcpSection
        detail={detail}
        busy={busy}
        allMcpServers={allMcpServers}
        availableMcpServers={availableMcpServers}
        onCreateOpen={() => setMcpCreateOpen(true)}
        onAssign={handleAssignMcpServer}
        onRemove={setRemoveConfirm}
      />
      <ProfileComposioSection
        busy={busy}
        composioToolkitsData={composioToolkitsData}
        assignedComposioToolkits={assignedComposioToolkits}
        availableComposioToolkits={availableComposioToolkits}
        onAssign={handleAssignComposioToolkit}
        onRemove={setRemoveConfirm}
      />
      <ProfileSkillsSection
        detail={detail}
        busy={busy}
        allSkills={allSkills}
        assignedSkillIds={assignedSkillIds}
        onCreateOpen={() => setSkillCreateOpen(true)}
        onAssign={handleAssignSkill}
        onDelete={handleDeleteSkill}
        onViewDetail={setDetailSkillId}
        onRemove={setRemoveConfirm}
      />
    </>
  );
}
