import type { ProfileDetail } from "@nakama/core/contract";
import { ProfileSkillsCuratorConsolidateField } from "@/components/profiles/ProfileSkillsCuratorConsolidateField";
import { ProfileSkillsPostTurnReviewField } from "@/components/profiles/ProfileSkillsPostTurnReviewField";
import { ProfileSkillsWriteApprovalField } from "@/components/profiles/ProfileSkillsWriteApprovalField";
import { useAuth } from "@/context/use-auth";

export function ProfileSkillsSettingsSection({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  const { activeOrg } = useAuth();

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  return (
    <div className="mb-3 divide-y divide-border rounded-md border border-border">
      <div className="p-3 sm:px-4 sm:py-3">
        <ProfileSkillsWriteApprovalField
          disabled={disabled}
          profile={profile}
        />
      </div>
      <div className="p-3 sm:px-4 sm:py-3">
        <ProfileSkillsPostTurnReviewField
          disabled={disabled}
          profile={profile}
        />
      </div>
      <div className="p-3 sm:px-4 sm:py-3">
        <ProfileSkillsCuratorConsolidateField
          disabled={disabled}
          profile={profile}
        />
      </div>
    </div>
  );
}
