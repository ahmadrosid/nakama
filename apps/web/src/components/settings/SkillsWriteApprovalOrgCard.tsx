import type { ProfileSummary } from "@nakama/core/contract";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type SkillApprovalTab = "gate" | "proposals";

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

function SkillApprovalTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "-mb-px border-b-2 px-0 py-2.5 text-sm transition-colors",
        active
          ? "border-foreground font-semibold text-foreground"
          : "border-transparent font-normal text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function OrgProfileSkillsWriteApprovalOverrideSelect({
  profile,
  disabled = false,
}: {
  profile: ProfileSummary;
  disabled?: boolean;
}) {
  const updateMutation = useUpdateProfileMutation();
  const [value, setValue] = useState<OverrideValue>(() =>
    toOverrideValue(profile.skillsWriteApproval)
  );
  const busy = updateMutation.isPending;

  async function handleOverrideChange(nextValue: OverrideValue) {
    setValue(nextValue);
    try {
      await updateMutation.mutateAsync({
        input: { skillsWriteApproval: fromOverrideValue(nextValue) },
        profileId: profile.id,
      });
      toast("Profile skill write approval setting saved.");
    } catch (err) {
      setValue(toOverrideValue(profile.skillsWriteApproval));
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
        <SelectTrigger
          aria-label="Skill write approval override"
          className="h-8 max-w-xs"
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
    </>
  );
}

function OrgProfileSkillsWriteApprovalField({
  profiles,
  disabled = false,
}: {
  profiles: ProfileSummary[];
  disabled?: boolean;
}) {
  const [profileId, setProfileId] = useState<string>("");
  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ?? null;

  if (profiles.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-3">
      <p className="mb-2 font-medium text-muted-foreground text-xs">
        Per-profile override
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          disabled={disabled}
          onValueChange={(next) => setProfileId(next ? String(next) : "")}
          value={profileId}
        >
          <SelectTrigger aria-label="Profile" className="h-8 max-w-xs">
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
          <OrgProfileSkillsWriteApprovalOverrideSelect
            disabled={disabled}
            key={`${selectedProfile.id}:${String(selectedProfile.skillsWriteApproval)}`}
            profile={selectedProfile}
          />
        ) : (
          <Select disabled value="inherit">
            <SelectTrigger
              aria-label="Skill write approval override"
              className="h-8 max-w-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit org default</SelectItem>
              <SelectItem value="on">Require approval</SelectItem>
              <SelectItem value="off">Allow immediate writes</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="mt-1.5 text-muted-foreground text-xs">
        Overrides the org-wide gate for the selected profile only.
      </p>
    </div>
  );
}

export function SkillsWriteApprovalOrgCard() {
  const { activeOrg, updateOrg } = useAuth();
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<SkillApprovalTab>("gate");
  const orgId = activeOrg?.id ?? null;
  const filterProfileId = searchParams.get("profileId") ?? undefined;

  const { data: proposalsData } = useSkillProposals(orgId, {
    status: "pending",
  });
  const { data: profiles = [] } = useProfilesQuery();
  const pendingCount = proposalsData?.pendingCount ?? 0;

  useEffect(() => {
    if (searchParams.get("skillProposals") === "proposals") {
      setActiveTab("proposals");
    }
  }, [searchParams]);

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const enabled = activeOrg.skillsWriteApproval === true;

  async function handleToggle(checked: boolean) {
    setBusy(true);
    try {
      await updateOrg(activeOrg!.id, { skillsWriteApproval: checked });
      toast(
        checked
          ? "Skill write approval enabled."
          : "Skill write approval disabled."
      );
    } catch (err) {
      toast(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <div className="border-border border-b px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              Skill write approval
            </p>
            <p className="max-w-prose text-muted-foreground text-xs leading-relaxed">
              When enabled, agent skill creates, patches, and deletes require
              org admin approval before they go live.
            </p>
          </div>
          {activeTab === "gate" ? (
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {busy ? <Spinner /> : null}
              <Switch
                aria-label="Require approval for skill writes"
                checked={enabled}
                disabled={busy}
                onCheckedChange={(checked) => void handleToggle(checked)}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-border border-b px-4">
        <div className="flex gap-5">
          <SkillApprovalTabButton
            active={activeTab === "gate"}
            onClick={() => setActiveTab("gate")}
          >
            Gate settings
          </SkillApprovalTabButton>
          <SkillApprovalTabButton
            active={activeTab === "proposals"}
            onClick={() => setActiveTab("proposals")}
          >
            Proposals
            {pendingCount > 0 ? (
              <span className="ml-1 font-normal text-muted-foreground text-xs">
                ({pendingCount > 99 ? "99+" : pendingCount})
              </span>
            ) : null}
          </SkillApprovalTabButton>
        </div>
      </div>

      {activeTab === "proposals" ? (
        orgId ? (
          <SkillProposalsPanel
            orgId={orgId}
            profileId={filterProfileId}
            showProfileLabels
          />
        ) : null
      ) : (
        <OrgProfileSkillsWriteApprovalField
          disabled={busy}
          profiles={profiles}
        />
      )}
    </Card>
  );
}
