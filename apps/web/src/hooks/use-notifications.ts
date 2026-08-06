import { useMemo } from "react";
import { useAuth } from "@/context/use-auth";
import { useAutomationsQuery } from "@/hooks/use-automations";
import { useOrgMemoryProposals } from "@/hooks/use-org-memory-proposals";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { PAGE_PATHS, orgSkillProposalsPath } from "@/lib/navigation";

export type NotificationKind = "automation-run" | "org-memory-proposal" | "skill-proposal";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  kindLabel: string;
  title: string;
  description: string;
  href: string;
  count: number;
  createdAt?: string;
}

export function useNotifications(): {
  items: NotificationItem[];
  automationItems: NotificationItem[];
  orgMemoryItems: NotificationItem[];
  skillProposalItems: NotificationItem[];
  totalCount: number;
  isLoading: boolean;
} {
  const { activeOrg, isAuthenticated, isLoading: authLoading } = useAuth();
  const isOrgAdmin = activeOrg?.role === "admin";
  const orgId = activeOrg?.id ?? null;

  const { data: automationsData, isLoading: automationsLoading } = useAutomationsQuery();
  const { data: proposalsData, isLoading: proposalsLoading } = useOrgMemoryProposals(
    isOrgAdmin ? orgId : null,
    "pending",
    { refetchInterval: 30_000 },
  );
  const { data: skillProposalsData, isLoading: skillProposalsLoading } = useSkillProposals(
    isOrgAdmin ? orgId : null,
    { status: "pending", refetchInterval: 30_000 },
  );

  const { items, automationItems, orgMemoryItems, skillProposalItems } = useMemo(() => {
    const automationItems: NotificationItem[] = [];
    const orgMemoryItems: NotificationItem[] = [];
    const skillProposalItems: NotificationItem[] = [];

    const automations = automationsData?.automations ?? [];
    const unreadByAutomationId = automationsData?.unread?.byAutomationId ?? {};

    for (const automation of automations) {
      const count = unreadByAutomationId[automation.id] ?? 0;
      if (count <= 0) {
        continue;
      }

      automationItems.push({
        id: `automation-${automation.id}`,
        kind: "automation-run",
        kindLabel: "Automation",
        title: automation.name,
        description:
          count === 1 ? "1 unread automation run" : `${count} unread automation runs`,
        href: `${PAGE_PATHS.automations}?automation=${encodeURIComponent(automation.id)}`,
        count,
        createdAt: automation.lastRunAt ?? undefined,
      });
    }

    for (const proposal of proposalsData?.proposals ?? []) {
      orgMemoryItems.push({
        id: `org-memory-${proposal.id}`,
        kind: "org-memory-proposal",
        kindLabel: "Org memory",
        title: "Memory proposal awaiting review",
        description: proposal.bullet,
        href: `${PAGE_PATHS.soul}?tab=organization&orgMemory=proposals`,
        count: 1,
        createdAt: proposal.createdAt,
      });
    }

    for (const proposal of skillProposalsData?.proposals ?? []) {
      skillProposalItems.push({
        id: `skill-proposal-${proposal.id}`,
        kind: "skill-proposal",
        kindLabel: "Skill proposal",
        title: `${proposal.action} · ${proposal.skillName}`,
        description: "Skill change awaiting admin approval",
        href: orgSkillProposalsPath(proposal.profileId),
        count: 1,
        createdAt: proposal.createdAt,
      });
    }

    return {
      items: [...automationItems, ...orgMemoryItems, ...skillProposalItems],
      automationItems,
      orgMemoryItems,
      skillProposalItems,
    };
  }, [automationsData, proposalsData?.proposals, skillProposalsData?.proposals]);

  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const isLoading =
    authLoading ||
    !isAuthenticated ||
    automationsLoading ||
    (isOrgAdmin && (proposalsLoading || skillProposalsLoading));

  return { items, automationItems, orgMemoryItems, skillProposalItems, totalCount, isLoading };
}
