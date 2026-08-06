import type { ProfileDetail } from "@nakama/core/contract";
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
    <div className="mb-3 grid grid-cols-1 divide-y divide-border rounded-md border border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      <div className="p-3 sm:p-4">
        <ProfileSkillsWriteApprovalField profile={profile} disabled={disabled} />
      </div>
      <div className="p-3 sm:p-4">
        <ProfileSkillsPostTurnReviewField profile={profile} disabled={disabled} />
      </div>
    </div>
  );
}
