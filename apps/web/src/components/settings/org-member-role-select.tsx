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

const ROLE_HINTS: Record<OrgRole, string> = {
  admin: "Manages members and settings",
  member: "Chats and uses agents",
  viewer: "Read only",
};

export function OrgMemberRoleCards({
  value,
  onChange,
}: {
  value: OrgRole;
  onChange: (role: OrgRole) => void;
}) {
  return (
    <div className="space-y-1.5" role="radiogroup">
      {ROLES.map((role) => (
        <label
          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 ${
            value === role
              ? "border-primary bg-primary/5"
              : "border-border bg-background"
          }`}
          key={role}
        >
          <input
            checked={value === role}
            className="size-3.5 accent-primary"
            name="member-role"
            onChange={() => onChange(role)}
            type="radio"
            value={role}
          />
          <span>
            <span className="block font-medium text-sm">
              {ROLE_LABELS[role]}
            </span>
            <span className="block text-muted-foreground text-xs">
              {ROLE_HINTS[role]}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}
