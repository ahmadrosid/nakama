import type { ProfileDetail } from "@nakama/core/contract";
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

export function ProfileSkillsWriteApprovalField({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  return (
    <ProfileSkillsWriteApprovalFieldBody
      disabled={disabled}
      key={`${profile.id}:${String(profile.skillsWriteApproval)}`}
      profile={profile}
    />
  );
}

function ProfileSkillsWriteApprovalFieldBody({
  profile,
  disabled = false,
}: {
  profile: ProfileDetail;
  disabled?: boolean;
}) {
  const { activeOrg } = useAuth();
  const updateMutation = useUpdateProfileMutation();
  const [value, setValue] = useState<OverrideValue>(() =>
    toOverrideValue(profile.skillsWriteApproval)
  );
  const busy = updateMutation.isPending;

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  async function handleChange(nextValue: OverrideValue) {
    setValue(nextValue);
    try {
      await updateMutation.mutateAsync({
        input: { skillsWriteApproval: fromOverrideValue(nextValue) },
        profileId: profile.id,
      });
      toast("Skill write approval setting saved.");
    } catch (err) {
      setValue(toOverrideValue(profile.skillsWriteApproval));
      toast(formatError(err));
    }
  }

  return (
    <div>
      <label
        className="mb-1 block text-balance font-medium text-muted-foreground text-xs"
        htmlFor="profile-skills-write-approval"
      >
        Skill write approval
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
          <SelectTrigger
            className="max-w-xs"
            id="profile-skills-write-approval"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit org default</SelectItem>
            <SelectItem value="on">Require approval</SelectItem>
            <SelectItem value="off">Allow immediate writes</SelectItem>
          </SelectContent>
        </Select>
        {busy ? <Spinner /> : null}
      </div>
    </div>
  );
}
