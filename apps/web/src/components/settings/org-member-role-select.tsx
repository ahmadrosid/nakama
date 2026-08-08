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
      disabled={disabled}
      onValueChange={(next) => {
        if (next) {
          onChange(next as OrgRole);
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label="Member role" size="sm">
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
