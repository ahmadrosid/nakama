import { useState } from "react";
import type { ProfileSummary } from "@nakama/core/contract";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
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

function OrgProfilePostTurnReviewOverrideSelect({
  profile,
  disabled = false,
}: {
  profile: ProfileSummary;
  disabled?: boolean;
}) {
  const updateMutation = useUpdateProfileMutation();
  const [value, setValue] = useState<OverrideValue>(() =>
    toOverrideValue(profile.skillsPostTurnReview),
  );
  const busy = updateMutation.isPending;

  async function handleOverrideChange(nextValue: OverrideValue) {
    setValue(nextValue);
    try {
      await updateMutation.mutateAsync({
        profileId: profile.id,
        input: { skillsPostTurnReview: fromOverrideValue(nextValue) },
      });
      toast("Profile post-turn review setting saved.");
    } catch (err) {
      setValue(toOverrideValue(profile.skillsPostTurnReview));
      toast(formatError(err));
    }
  }

  return (
    <>
      <Select
        value={value}
        disabled={disabled || busy}
        onValueChange={(next) => {
          if (!next) {
            return;
          }
          void handleOverrideChange(next as OverrideValue);
        }}
      >
        <SelectTrigger className="h-8 max-w-xs" aria-label="Post-turn skill review override">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">Inherit org default</SelectItem>
          <SelectItem value="on">Enable review</SelectItem>
          <SelectItem value="off">Disable review</SelectItem>
        </SelectContent>
      </Select>
      {busy ? <Spinner /> : null}
    </>
  );
}

function OrgProfilePostTurnReviewField({
  profiles,
  disabled = false,
}: {
  profiles: ProfileSummary[];
  disabled?: boolean;
}) {
  const [profileId, setProfileId] = useState<string>("");
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;

  if (profiles.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Per-profile override</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={profileId}
          disabled={disabled}
          onValueChange={(next) => setProfileId(next ? String(next) : "")}
        >
          <SelectTrigger className="h-8 max-w-xs" aria-label="Profile">
            <SelectValue placeholder="Select profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedProfile ? (
          <OrgProfilePostTurnReviewOverrideSelect
            key={`${selectedProfile.id}:${String(selectedProfile.skillsPostTurnReview)}`}
            profile={selectedProfile}
            disabled={disabled}
          />
        ) : (
          <Select value="inherit" disabled>
            <SelectTrigger className="h-8 max-w-xs" aria-label="Post-turn skill review override">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit org default</SelectItem>
              <SelectItem value="on">Enable review</SelectItem>
              <SelectItem value="off">Disable review</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Overrides the org-wide post-turn review setting for the selected profile only.
      </p>
    </div>
  );
}

export function SkillsPostTurnReviewOrgCard() {
  const { activeOrg, updateOrg } = useAuth();
  const [busy, setBusy] = useState(false);
  const { data: profiles = [] } = useProfilesQuery();

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const enabled = activeOrg.skillsPostTurnReview === true;

  async function handleToggle(checked: boolean) {
    setBusy(true);
    try {
      await updateOrg(activeOrg!.id, { skillsPostTurnReview: checked });
      toast(checked ? "Post-turn skill review enabled." : "Post-turn skill review disabled.");
    } catch (err) {
      toast(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">Post-turn skill review</p>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Suggest skill updates after complex chats. Apply directly, or stage for admin review when
              write approval is on.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {busy ? <Spinner /> : null}
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => void handleToggle(checked)}
              aria-label="Enable post-turn skill review"
            />
          </div>
        </div>
      </div>
      <OrgProfilePostTurnReviewField profiles={profiles} disabled={busy} />
    </Card>
  );
}
