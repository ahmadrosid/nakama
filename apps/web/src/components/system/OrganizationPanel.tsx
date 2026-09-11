import { OrgArchiveCard } from "@/components/settings/OrgArchiveCard";
import { OrgLlmQuotaCard } from "@/components/settings/OrgLlmQuotaCard";
import { OrgMembersCard } from "@/components/settings/OrgMembersCard";
import { OrgMemoryCard } from "@/components/settings/OrgMemoryCard";
import { SkillsCuratorOrgCard } from "@/components/settings/SkillsCuratorOrgCard";
import { SkillsPostTurnReviewOrgCard } from "@/components/settings/SkillsPostTurnReviewOrgCard";
import { SkillsWriteApprovalOrgCard } from "@/components/settings/SkillsWriteApprovalOrgCard";

export function OrganizationPanel() {
  return (
    <div className="min-w-0 space-y-8 p-4 sm:p-5">
      <OrgMembersCard />
      <OrgLlmQuotaCard />
      <SkillsWriteApprovalOrgCard />
      <SkillsPostTurnReviewOrgCard />
      <SkillsCuratorOrgCard />
      <OrgMemoryCard />
      <OrgArchiveCard />
    </div>
  );
}
