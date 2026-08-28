import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OrgSettingsProfileBooleanOverrideField } from "@/components/profiles/ProfileOrgBooleanOverrideField";
import { SkillProposalsPanel } from "@/components/profiles/SkillProposalsPanel";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type SkillApprovalTab = "gate" | "proposals";

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
        <div className="flex items-center justify-between gap-4">
          <p className="font-medium text-foreground text-sm">
            Skill write approval
          </p>
          {activeTab === "gate" ? (
            <div className="flex shrink-0 items-center gap-2">
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
            Settings
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
        <OrgSettingsProfileBooleanOverrideField
          disabled={busy}
          field="skillsWriteApproval"
          profiles={profiles}
          savedToast="Profile skill write approval setting saved."
        />
      )}
    </Card>
  );
}
