import type { ProfileDetail } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
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
    <Card className="w-full overflow-hidden shadow-none">
      <CardContent className="divide-y divide-border p-0">
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
      </CardContent>
    </Card>
  );
}
