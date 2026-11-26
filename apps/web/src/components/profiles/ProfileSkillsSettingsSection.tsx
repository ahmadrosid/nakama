import type {
  ProfileDetail,
  UpdateProfileRequest,
} from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import { Clock01Icon, ToolsIcon, UserGroupIcon } from "hugeicons-react";
import type { ReactNode } from "react";
import { SettingIcon } from "@/components/profiles/ProfileOrgBooleanOverrideField";
import { ProfileSkillsCuratorConsolidateField } from "@/components/profiles/ProfileSkillsCuratorConsolidateField";
import { ProfileSkillsPostTurnReviewField } from "@/components/profiles/ProfileSkillsPostTurnReviewField";
import { ProfileSkillsWriteApprovalField } from "@/components/profiles/ProfileSkillsWriteApprovalField";
import { useAuth } from "@/context/use-auth";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { isProfileOwner } from "@/lib/profiles";

/** Org admins and the agent's owner can change its behavior switches. */
function useProfileSettingSave(profile: ProfileDetail, disabled: boolean) {
  const { activeOrg, user } = useAuth();
  const updateMutation = useUpdateProfileMutation();
  const readOnly = disabled || Boolean(profile.sharedAgent);

  const canEdit = Boolean(
    activeOrg &&
    (activeOrg.role === "admin" || isProfileOwner(profile, user?.id))
  );

  const save = (input: UpdateProfileRequest) => {
    if (readOnly) {
      return;
    }

    void updateMutation
      .mutateAsync({ input, profileId: profile.id })
      .then(() => toast("Saved."))
      .catch((error) => toast(formatError(error)));
  };

  return { canEdit, pending: updateMutation.isPending, readOnly, save };
}

/** Shown on the agent's Tools tab. Super Nakama has no switch. */
export function ProfilePlatformToolsSwitch({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  const { canEdit, pending, readOnly, save } = useProfileSettingSave(
    profile,
    disabled
  );

  if (!canEdit || profile.isSuper) {
    return null;
  }

  return (
    <BehaviorSwitchSection
      checked={profile.platformToolsEnabled !== false}
      heading="Chat tools"
      icon={<ToolsIcon size={18} />}
      id="platform-tools"
      label="Platform tools"
      onChange={(platformToolsEnabled) => save({ platformToolsEnabled })}
      pending={pending}
      readOnly={readOnly}
    />
  );
}

export function ProfileSkillsSettingsSection({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  const { canEdit, pending, readOnly, save } = useProfileSettingSave(
    profile,
    disabled
  );

  if (!canEdit) {
    return null;
  }

  const automationsEnabled = profile.automationsEnabled !== false;
  const groupsEnabled = profile.groupsEnabled !== false;

  return (
    <div className="flex w-full flex-col gap-6">
      <BehaviorSwitchSection
        checked={automationsEnabled}
        description="Run this agent's tasks on a schedule."
        heading="Scheduling"
        icon={<Clock01Icon size={18} />}
        id="automations"
        label="Automations"
        onChange={(automationsEnabled) => save({ automationsEnabled })}
        pending={pending}
        readOnly={readOnly}
      />
      {profile.isSuper ? (
        <BehaviorSwitchSection
          checked={groupsEnabled}
          description="Let this agent create group chats for you."
          heading="Groups"
          icon={<UserGroupIcon size={18} />}
          id="groups"
          label="Create groups"
          onChange={(groupsEnabled) => save({ groupsEnabled })}
          pending={pending}
          readOnly={readOnly}
        />
      ) : null}
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

function BehaviorSwitchSection({
  checked,
  description,
  heading,
  icon,
  id,
  label,
  onChange,
  pending,
  readOnly,
}: {
  checked: boolean;
  description?: string;
  heading: string;
  icon: ReactNode;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
  pending: boolean;
  readOnly: boolean;
}) {
  const switchId = `profile-${id}-enabled`;
  const descriptionId = description ? `${switchId}-description` : undefined;

  return (
    <section
      aria-labelledby={`profile-behavior-${id}`}
      className="flex flex-col gap-2"
    >
      <h3 className="type-label" id={`profile-behavior-${id}`}>
        {heading}
      </h3>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 p-3 sm:px-4 sm:py-3">
            <label
              className="flex min-w-0 items-center gap-3 text-balance font-medium text-foreground text-sm"
              htmlFor={switchId}
            >
              <SettingIcon checked={checked}>{icon}</SettingIcon>
              <span className="min-w-0">
                <span className="block">{label}</span>
                {description ? (
                  <span
                    className="mt-1 block text-pretty font-normal text-muted-foreground text-xs"
                    id={descriptionId}
                  >
                    {description}
                  </span>
                ) : null}
              </span>
            </label>
            <div className="flex shrink-0 items-center gap-2">
              {pending ? <Spinner /> : null}
              <Switch
                aria-describedby={descriptionId}
                aria-label={label}
                checked={checked}
                disabled={readOnly}
                id={switchId}
                onCheckedChange={onChange}
                size="sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
