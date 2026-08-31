import { useState } from "react";
import { OrgSettingsProfileBooleanOverrideField } from "@/components/profiles/ProfileOrgBooleanOverrideField";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

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
      toast(
        checked ? "Learn after a turn enabled." : "Learn after a turn disabled."
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
            Learn after a turn
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {busy ? <Spinner /> : null}
            <Switch
              aria-label="Enable learn after a turn"
              checked={enabled}
              disabled={busy}
              onCheckedChange={(checked) => void handleToggle(checked)}
            />
          </div>
        </div>
      </div>
      <OrgSettingsProfileBooleanOverrideField
        disabled={busy}
        field="skillsPostTurnReview"
        profiles={profiles}
        savedToast="Learn after a turn setting saved."
      />
    </Card>
  );
}
