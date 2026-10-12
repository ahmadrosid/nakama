import { Card } from "@nakama/ui/card";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import { ArrowDown01Icon } from "hugeicons-react";
import { useState } from "react";
import { SkillsCuratorOrgCard } from "@/components/settings/SkillsCuratorOrgCard";
import { SkillsPostTurnReviewOrgCard } from "@/components/settings/SkillsPostTurnReviewOrgCard";
import { SkillsWriteApprovalOrgCard } from "@/components/settings/SkillsWriteApprovalOrgCard";
import { useAuth } from "@/context/use-auth";
import { formatError } from "@/lib/client";

type Preset = "off" | "ask" | "auto";

const PRESETS: {
  id: Preset;
  label: string;
  hint: string;
  patch: {
    skillsPostTurnReview: boolean;
    skillsWriteApproval: boolean;
    skillsCuratorEnabled: boolean;
    skillsCuratorConsolidateEnabled: boolean;
  };
}[] = [
  {
    hint: "Bots do not save new skills.",
    id: "off",
    label: "Off",
    patch: {
      skillsCuratorConsolidateEnabled: false,
      skillsCuratorEnabled: false,
      skillsPostTurnReview: false,
      skillsWriteApproval: false,
    },
  },
  {
    hint: "Bots learn from chats. You approve each new skill.",
    id: "ask",
    label: "Ask me first",
    patch: {
      skillsCuratorConsolidateEnabled: false,
      skillsCuratorEnabled: false,
      skillsPostTurnReview: true,
      skillsWriteApproval: true,
    },
  },
  {
    hint: "Bots learn and tidy their skills alone.",
    id: "auto",
    label: "Automatic",
    patch: {
      skillsCuratorConsolidateEnabled: true,
      skillsCuratorEnabled: true,
      skillsPostTurnReview: true,
      skillsWriteApproval: false,
    },
  },
];

export function SkillsLearningOrgCard() {
  const { activeOrg, updateOrg } = useAuth();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const current = PRESETS.find(
    ({ patch }) =>
      (activeOrg.skillsPostTurnReview === true) ===
        patch.skillsPostTurnReview &&
      (activeOrg.skillsWriteApproval === true) === patch.skillsWriteApproval &&
      (activeOrg.skillsCuratorEnabled === true) ===
        patch.skillsCuratorEnabled &&
      (activeOrg.skillsCuratorConsolidateEnabled === true) ===
        patch.skillsCuratorConsolidateEnabled
  )?.id;

  async function choose(preset: (typeof PRESETS)[number]) {
    setBusy(true);

    try {
      await updateOrg(activeOrg!.id, preset.patch);
      toast(`Skill learning: ${preset.label}.`);
    } catch (err) {
      toast(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full overflow-hidden shadow-none">
        <div className="border-border border-b px-4 py-3">
          <p className="font-medium text-foreground text-sm">
            How bots learn skills
          </p>
        </div>
        <div
          aria-label="How bots learn skills"
          className="grid gap-2 p-4 sm:grid-cols-3"
          role="radiogroup"
        >
          {PRESETS.map((preset) => (
            <button
              aria-checked={current === preset.id}
              className={cn(
                "rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-60",
                current === preset.id
                  ? "border-foreground bg-muted"
                  : "border-border hover:bg-muted/50"
              )}
              disabled={busy}
              key={preset.id}
              onClick={() => void choose(preset)}
              role="radio"
              type="button"
            >
              <span className="block font-medium text-foreground text-sm">
                {preset.label}
              </span>
              <span className="mt-1 block text-muted-foreground text-xs">
                {preset.hint}
              </span>
            </button>
          ))}
        </div>
        <button
          aria-expanded={open}
          className="flex w-full items-center justify-between border-border border-t px-4 py-3 text-left text-foreground text-sm"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span>
            Customize
            {current ? null : (
              <span className="ml-2 text-muted-foreground text-xs">
                Custom setup
              </span>
            )}
          </span>
          <ArrowDown01Icon
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </Card>
      {open ? (
        <>
          <SkillsWriteApprovalOrgCard />
          <SkillsPostTurnReviewOrgCard />
          <SkillsCuratorOrgCard />
        </>
      ) : null}
    </div>
  );
}
