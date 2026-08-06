import { OrgMembersCard } from "@/components/settings/OrgMembersCard";
import { OrgMemoryCard } from "@/components/settings/OrgMemoryCard";

export function OrganizationPanel() {
  return (
    <div className="min-w-0 space-y-8 p-4 sm:p-5">
      <OrgMembersCard />
      <OrgMemoryCard />
    </div>
  );
}
