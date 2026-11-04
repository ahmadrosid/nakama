import type { MfaPolicyResponse, OrgRole } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import { useEffect, useState } from "react";
import { client, formatError } from "@/lib/client";

const roles: Array<{ label: string; value: OrgRole }> = [
  { label: "Admins", value: "admin" },
  { label: "Members", value: "member" },
];

export function PlatformMfaSettingsCard() {
  const [policy, setPolicy] = useState<MfaPolicyResponse | null>(null);
  const [draftRoles, setDraftRoles] = useState<OrgRole[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getMfaPolicy()
      .then((nextPolicy) => {
        setPolicy(nextPolicy);
        setDraftRoles(nextPolicy.enforcedRoles);
      })
      .catch((err) => setError(formatError(err)))
      .finally(() => setBusy(false));
  }, []);

  async function update(input: {
    enabled?: boolean;
    enforcedRoles?: OrgRole[];
    required?: boolean;
  }) {
    setBusy(true);
    setError(null);

    try {
      const nextPolicy = await client.updateMfaPolicy(input);
      setPolicy(nextPolicy);
      setDraftRoles(nextPolicy.enforcedRoles);

      if (input.enabled !== undefined) {
        toast(
          input.enabled
            ? "Multi-factor authentication enabled."
            : "Multi-factor authentication disabled."
        );
      } else if (input.required === undefined) {
        toast("MFA enforcement roles saved.");
      } else {
        toast(
          input.required
            ? "Multi-factor authentication enforcement enabled."
            : "Multi-factor authentication enforcement disabled."
        );
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const selectedRoles = new Set(draftRoles);

  const selectedRoleLabels = roles
    .flatMap(({ label, value }) => (selectedRoles.has(value) ? [label] : []))
    .join(", ");

  const allRolesSelected = draftRoles.length === roles.length;
  const savedRoles = new Set(policy?.enforcedRoles ?? []);

  const rolesChanged =
    policy !== null &&
    (draftRoles.length !== savedRoles.size ||
      draftRoles.some((role) => !savedRoles.has(role)));

  function toggleRole(role: OrgRole) {
    setDraftRoles((current) => {
      if (current.includes(role)) {
        return current.length === 1
          ? current
          : current.filter((value) => value !== role);
      }

      return [...current, role];
    });
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="font-medium text-foreground text-sm">
            Multi-factor authentication
          </span>
          <Switch
            aria-label="Enable platform multi-factor authentication"
            checked={policy?.enabled === true}
            disabled={busy || policy === null}
            onCheckedChange={(enabled) =>
              void update({
                enabled,
                required: enabled ? policy?.required : false,
              })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="font-medium text-foreground text-sm">
            Require for sign-in
          </span>
          <Switch
            aria-label="Enforce platform multi-factor authentication"
            checked={policy?.required === true}
            disabled={busy || policy === null || policy.enabled !== true}
            onCheckedChange={(required) => void update({ required })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground text-sm">Required for</p>
            <p className="text-muted-foreground text-xs">
              Platform admins always need it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-9 w-44 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || policy === null}
              >
                {allRolesSelected ? "All roles" : selectedRoleLabels}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-44">
                {roles.map(({ label, value }) => {
                  const selected = selectedRoles.has(value);

                  return (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => toggleRole(value)}
                    >
                      <span className="w-4 text-center text-primary">
                        {selected ? "✓" : ""}
                      </span>
                      {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {rolesChanged ? (
              <Button
                disabled={busy}
                onClick={() => void update({ enforcedRoles: draftRoles })}
                size="sm"
                type="button"
              >
                Save
              </Button>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="px-4 py-3 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
