import type {
  ProfileDetail,
  ProfileSummary,
  UpdateProfileRequest,
} from "@nakama/core/contract";
import { resolveProfileOrgBooleanOverride } from "@nakama/core/skills/profile-org-override";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/use-auth";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

type OverrideField = keyof Pick<
  UpdateProfileRequest,
  | "skillsWriteApproval"
  | "skillsPostTurnReview"
  | "skillsCuratorConsolidateEnabled"
>;

function toStoredOverride(value: boolean | null | undefined): boolean | null {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return null;
}

function BooleanOverrideSwitch({
  busy,
  checked,
  disabled,
  id,
  label,
  overridden,
  onCheckedChange,
  onReset,
}: {
  busy: boolean;
  checked: boolean;
  disabled: boolean;
  id?: string;
  label: string;
  overridden: boolean;
  onCheckedChange: (checked: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label
        className="min-w-0 text-balance font-medium text-foreground text-sm"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="flex shrink-0 items-center gap-2">
        {overridden ? (
          <Button
            disabled={disabled || busy}
            onClick={onReset}
            size="xs"
            type="button"
            variant="ghost"
          >
            Use org default
          </Button>
        ) : null}
        {busy ? <Spinner /> : null}
        <Switch
          aria-label={label}
          checked={checked}
          disabled={disabled || busy}
          id={id}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </div>
  );
}

export function ProfileOrgBooleanOverrideField({
  profile,
  disabled = false,
  field,
  id,
  label,
  savedToast,
}: {
  disabled?: boolean;
  field: OverrideField;
  id: string;
  label: string;
  profile: ProfileDetail;
  savedToast: string;
}) {
  return (
    <ProfileOrgBooleanOverrideFieldBody
      disabled={disabled}
      field={field}
      id={id}
      key={`${profile.id}:${field}:${String(profile[field])}`}
      label={label}
      profile={profile}
      savedToast={savedToast}
    />
  );
}

/** Org settings: one switch per profile. */
export function OrgSettingsProfileBooleanOverrideField({
  profiles,
  disabled = false,
  field,
  savedToast,
}: {
  disabled?: boolean;
  field: OverrideField;
  profiles: ProfileSummary[];
  savedToast: string;
}) {
  if (profiles.length === 0) {
    return null;
  }

  return (
    <ul className="divide-y divide-border">
      {profiles.map((profile) => (
        <li className="px-4 py-3" key={profile.id}>
          <OrgSettingsProfileOverrideSwitch
            disabled={disabled}
            field={field}
            key={`${profile.id}:${field}:${String(profile[field])}`}
            profile={profile}
            savedToast={savedToast}
          />
        </li>
      ))}
    </ul>
  );
}

function useProfileBooleanOverride(
  profile: ProfileDetail | ProfileSummary,
  field: OverrideField,
  savedToast: string
) {
  const { activeOrg } = useAuth();
  const updateMutation = useUpdateProfileMutation();
  const [override, setOverride] = useState<boolean | null>(() =>
    toStoredOverride(profile[field])
  );
  const busy = updateMutation.isPending;
  const orgOn = activeOrg?.[field] === true;
  const checked = resolveProfileOrgBooleanOverride(override, orgOn);
  const overridden = override !== null;

  async function persist(next: boolean | null) {
    const previous = override;
    setOverride(next);
    try {
      await updateMutation.mutateAsync({
        input: { [field]: next },
        profileId: profile.id,
      });
      toast(savedToast);
    } catch (err) {
      setOverride(previous);
      toast(formatError(err));
    }
  }

  return {
    busy,
    checked,
    overridden,
    persist,
    role: activeOrg?.role,
  };
}

function OrgSettingsProfileOverrideSwitch({
  profile,
  disabled = false,
  field,
  savedToast,
}: {
  disabled?: boolean;
  field: OverrideField;
  profile: ProfileSummary;
  savedToast: string;
}) {
  const state = useProfileBooleanOverride(profile, field, savedToast);

  return (
    <BooleanOverrideSwitch
      busy={state.busy}
      checked={state.checked}
      disabled={disabled}
      label={profile.name}
      onCheckedChange={(next) => {
        void state.persist(next);
      }}
      onReset={() => {
        void state.persist(null);
      }}
      overridden={state.overridden}
    />
  );
}

function ProfileOrgBooleanOverrideFieldBody({
  profile,
  disabled = false,
  field,
  id,
  label,
  savedToast,
}: {
  disabled?: boolean;
  field: OverrideField;
  id: string;
  label: string;
  profile: ProfileDetail;
  savedToast: string;
}) {
  const state = useProfileBooleanOverride(profile, field, savedToast);

  if (state.role !== "admin") {
    return null;
  }

  return (
    <BooleanOverrideSwitch
      busy={state.busy}
      checked={state.checked}
      disabled={disabled}
      id={id}
      label={label}
      onCheckedChange={(next) => {
        void state.persist(next);
      }}
      onReset={() => {
        void state.persist(null);
      }}
      overridden={state.overridden}
    />
  );
}
