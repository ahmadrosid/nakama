import type { OrgRole } from "@nakama/core/contract";

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  member: "Member",
};

const ROLES: OrgRole[] = ["admin", "member"];

const ROLE_HINTS: Record<OrgRole, string> = {
  admin: "Manages members and settings",
  member: "Chats and uses agents",
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
