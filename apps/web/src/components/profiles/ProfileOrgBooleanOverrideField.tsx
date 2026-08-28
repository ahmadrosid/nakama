import type {
  ProfileDetail,
  ProfileSummary,
  UpdateProfileRequest,
} from "@nakama/core/contract";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

type OverrideValue = "inherit" | "on" | "off";

type OverrideField = keyof Pick<
  UpdateProfileRequest,
  | "skillsWriteApproval"
  | "skillsPostTurnReview"
  | "skillsCuratorConsolidateEnabled"
>;

function toOverrideValue(value: boolean | null | undefined): OverrideValue {
  if (value === true) {
    return "on";
  }
  if (value === false) {
    return "off";
  }
  return "inherit";
}

function fromOverrideValue(value: OverrideValue): boolean | null {
  if (value === "on") {
    return true;
  }
  if (value === "off") {
    return false;
  }
  return null;
}

export function ProfileOrgBooleanOverrideField({
  profile,
  disabled = false,
  field,
  id,
  label,
  offLabel,
  onLabel,
  savedToast,
}: {
  disabled?: boolean;
  field: OverrideField;
  id: string;
  label: string;
  offLabel: string;
  onLabel: string;
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
      offLabel={offLabel}
      onLabel={onLabel}
      profile={profile}
      savedToast={savedToast}
    />
  );
}

/** Org settings: pick a profile, then set inherit/on/off for one boolean field. */
export function OrgSettingsProfileBooleanOverrideField({
  profiles,
  disabled = false,
  field,
  ariaLabel,
  offLabel,
  onLabel,
  savedToast,
}: {
  ariaLabel: string;
  disabled?: boolean;
  field: OverrideField;
  offLabel: string;
  onLabel: string;
  profiles: ProfileSummary[];
  savedToast: string;
}) {
  const [profileId, setProfileId] = useState("");
  const selected = profiles.find((profile) => profile.id === profileId) ?? null;

  if (profiles.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <Select
        disabled={disabled}
        onValueChange={(next) => setProfileId(next ? String(next) : "")}
        value={profileId}
      >
        <SelectTrigger aria-label="Profile override" className="h-8 max-w-xs">
          <SelectValue placeholder="Profile override" />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <OrgSettingsProfileOverrideSelect
          ariaLabel={ariaLabel}
          disabled={disabled}
          field={field}
          key={`${selected.id}:${field}:${String(selected[field])}`}
          offLabel={offLabel}
          onLabel={onLabel}
          profile={selected}
          savedToast={savedToast}
        />
      ) : null}
    </div>
  );
}

function OrgSettingsProfileOverrideSelect({
  profile,
  disabled = false,
  field,
  ariaLabel,
  offLabel,
  onLabel,
  savedToast,
}: {
  ariaLabel: string;
  disabled?: boolean;
  field: OverrideField;
  offLabel: string;
  onLabel: string;
  profile: ProfileSummary;
  savedToast: string;
}) {
  const updateMutation = useUpdateProfileMutation();
  const [value, setValue] = useState<OverrideValue>(() =>
    toOverrideValue(profile[field])
  );
  const busy = updateMutation.isPending;

  async function handleOverrideChange(nextValue: OverrideValue) {
    setValue(nextValue);
    try {
      await updateMutation.mutateAsync({
        input: { [field]: fromOverrideValue(nextValue) },
        profileId: profile.id,
      });
      toast(savedToast);
    } catch (err) {
      setValue(toOverrideValue(profile[field]));
      toast(formatError(err));
    }
  }

  return (
    <>
      <Select
        disabled={disabled || busy}
        onValueChange={(next) => {
          if (!next) {
            return;
          }
          void handleOverrideChange(next as OverrideValue);
        }}
        value={value}
      >
        <SelectTrigger aria-label={ariaLabel} className="h-8 max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">Inherit org default</SelectItem>
          <SelectItem value="on">{onLabel}</SelectItem>
          <SelectItem value="off">{offLabel}</SelectItem>
        </SelectContent>
      </Select>
      {busy ? <Spinner /> : null}
    </>
  );
}

function ProfileOrgBooleanOverrideFieldBody({
  profile,
  disabled = false,
  field,
  id,
  label,
  offLabel,
  onLabel,
  savedToast,
}: {
  disabled?: boolean;
  field: OverrideField;
  id: string;
  label: string;
  offLabel: string;
  onLabel: string;
  profile: ProfileDetail;
  savedToast: string;
}) {
  const { activeOrg } = useAuth();
  const updateMutation = useUpdateProfileMutation();
  const [value, setValue] = useState<OverrideValue>(() =>
    toOverrideValue(profile[field])
  );
  const busy = updateMutation.isPending;

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  async function handleChange(nextValue: OverrideValue) {
    setValue(nextValue);
    try {
      await updateMutation.mutateAsync({
        input: { [field]: fromOverrideValue(nextValue) },
        profileId: profile.id,
      });
      toast(savedToast);
    } catch (err) {
      setValue(toOverrideValue(profile[field]));
      toast(formatError(err));
    }
  }

  return (
    <div>
      <label
        className="mb-1 block text-balance font-medium text-muted-foreground text-xs"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Select
          disabled={disabled || busy}
          onValueChange={(next) => {
            if (!next) {
              return;
            }
            void handleChange(next as OverrideValue);
          }}
          value={value}
        >
          <SelectTrigger className="max-w-xs" id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit org default</SelectItem>
            <SelectItem value="on">{onLabel}</SelectItem>
            <SelectItem value="off">{offLabel}</SelectItem>
          </SelectContent>
        </Select>
        {busy ? <Spinner /> : null}
      </div>
    </div>
  );
}
