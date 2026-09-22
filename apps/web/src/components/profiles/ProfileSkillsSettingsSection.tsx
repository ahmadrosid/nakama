import type { ProfileDetail } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import { ProfileSkillsCuratorConsolidateField } from "@/components/profiles/ProfileSkillsCuratorConsolidateField";
import { ProfileSkillsPostTurnReviewField } from "@/components/profiles/ProfileSkillsPostTurnReviewField";
import { ProfileSkillsWriteApprovalField } from "@/components/profiles/ProfileSkillsWriteApprovalField";
import { useAuth } from "@/context/use-auth";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";

export function ProfileSkillsSettingsSection({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  const { activeOrg } = useAuth();
  const updateMutation = useUpdateProfileMutation();

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex items-center justify-between gap-3 p-3 sm:px-4 sm:py-3">
          <label
            className="flex min-w-0 items-center gap-3 text-balance font-medium text-foreground text-sm"
            htmlFor="profile-automations-enabled"
          >
            <span className="min-w-0">
              <span className="block">Automations</span>
              <span
                className="mt-1 block text-pretty font-normal text-muted-foreground text-xs"
                id="profile-automations-enabled-description"
              >
                Allow this agent to create and run automations.
              </span>
            </span>
          </label>
          <div className="flex shrink-0 items-center gap-2">
            {updateMutation.isPending ? <Spinner /> : null}
            <Switch
              aria-describedby="profile-automations-enabled-description"
              aria-label="Automations"
              checked={profile.automationsEnabled !== false}
              disabled={disabled || updateMutation.isPending}
              id="profile-automations-enabled"
              onCheckedChange={(automationsEnabled) => {
                void updateMutation
                  .mutateAsync({
                    input: { automationsEnabled },
                    profileId: profile.id,
                  })
                  .then(() => toast("Automation setting saved."))
                  .catch((error) => toast(formatError(error)));
              }}
              size="sm"
            />
          </div>
        </div>
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
