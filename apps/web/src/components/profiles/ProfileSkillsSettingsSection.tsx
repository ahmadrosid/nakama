import type { ProfileDetail } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import { Clock01Icon } from "hugeicons-react";
import { SettingIcon } from "@/components/profiles/ProfileOrgBooleanOverrideField";
import { ProfileSkillsCuratorConsolidateField } from "@/components/profiles/ProfileSkillsCuratorConsolidateField";
import { ProfileSkillsPostTurnReviewField } from "@/components/profiles/ProfileSkillsPostTurnReviewField";
import { ProfileSkillsWriteApprovalField } from "@/components/profiles/ProfileSkillsWriteApprovalField";
import { useAuth } from "@/context/use-auth";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { isProfileOwner } from "@/lib/profiles";

export function ProfileSkillsSettingsSection({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  const { activeOrg, user } = useAuth();
  const updateMutation = useUpdateProfileMutation();
  const readOnly = disabled || Boolean(profile.sharedAgent);
  const isOrgAdmin = activeOrg?.role === "admin";

  if (!(activeOrg && (isOrgAdmin || isProfileOwner(profile, user?.id)))) {
    return null;
  }

  const automationsEnabled = profile.automationsEnabled !== false;

  return (
    <div className="flex w-full flex-col gap-6">
      <section
        aria-labelledby="profile-behavior-scheduling"
        className="flex flex-col gap-2"
      >
        <h3 className="type-label" id="profile-behavior-scheduling">
          Scheduling
        </h3>
        <Card className="w-full overflow-hidden shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 p-3 sm:px-4 sm:py-3">
              <label
                className="flex min-w-0 items-center gap-3 text-balance font-medium text-foreground text-sm"
                htmlFor="profile-automations-enabled"
              >
                <SettingIcon checked={automationsEnabled}>
                  <Clock01Icon size={18} />
                </SettingIcon>
                <span className="min-w-0">
                  <span className="block">Automations</span>
                  <span
                    className="mt-1 block text-pretty font-normal text-muted-foreground text-xs"
                    id="profile-automations-enabled-description"
                  >
                    Let this agent set up tasks that run on a schedule.
                  </span>
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-2">
                {updateMutation.isPending ? <Spinner /> : null}
                <Switch
                  aria-describedby="profile-automations-enabled-description"
                  aria-label="Automations"
                  checked={automationsEnabled}
                  disabled={readOnly || updateMutation.isPending}
                  id="profile-automations-enabled"
                  onCheckedChange={(automationsEnabled) => {
                    if (readOnly) {
                      return;
                    }

                    void updateMutation
                      .mutateAsync({
                        input: { automationsEnabled },
                        profileId: profile.id,
                      })
                      .then(() => toast("Saved."))
                      .catch((error) => toast(formatError(error)));
                  }}
                  size="sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
      <section
        aria-labelledby="profile-behavior-skills"
        className="flex flex-col gap-2"
      >
        <h3 className="type-label" id="profile-behavior-skills">
          Skill learning
        </h3>
        <Card className="w-full overflow-hidden shadow-none">
          <CardContent className="divide-y divide-border p-0">
            <div className="p-3 sm:px-4 sm:py-3">
              <ProfileSkillsWriteApprovalField
                disabled={readOnly}
                profile={profile}
              />
            </div>
            <div className="p-3 sm:px-4 sm:py-3">
              <ProfileSkillsPostTurnReviewField
                disabled={readOnly}
                profile={profile}
              />
            </div>
            <div className="p-3 sm:px-4 sm:py-3">
              <ProfileSkillsCuratorConsolidateField
                disabled={readOnly}
                profile={profile}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
