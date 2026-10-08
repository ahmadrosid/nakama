import type { OrgRole } from "@nakama/core/contract";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const ROLES: OrgRole[] = ["admin", "member", "viewer"];

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
        const role = ROLES.find((candidate) => candidate === next);

        if (role) {
          onChange(role);
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label="Member role" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
