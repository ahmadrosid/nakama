import type { OrgRole } from "@nakama/core/contract";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export function OrgMemberRoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: OrgRole;
  disabled?: boolean;
  onChange: (role: OrgRole) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) {
          onChange(next as OrgRole);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Member role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(ROLE_LABELS) as OrgRole[]).map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
