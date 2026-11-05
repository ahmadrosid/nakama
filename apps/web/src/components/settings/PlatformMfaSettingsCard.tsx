import type { MfaPolicyResponse, OrgRole } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import { ConfirmDialog } from "@nakama/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Switch } from "@nakama/ui/switch";
import { ArrowDown01Icon } from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
import { client, formatError } from "@/lib/client";

const roles: Array<{ label: string; value: OrgRole }> = [
  { label: "Admins", value: "admin" },
  { label: "Members", value: "member" },
];

type PolicyUpdate = {
  enabled?: boolean;
  enforcedRoles?: OrgRole[];
  required?: boolean;
};

/** Changes that lock people out or drop protection for every user ask first. */
const CONFIRMS = {
  disable: {
    confirmLabel: "Turn off",
    description:
      "No user on this instance will be asked for a second factor when they sign in.",
    title: "Turn off MFA for all users?",
  },
  require: {
    confirmLabel: "Require",
    description:
      "Users in the selected roles must set up an authenticator before they can use Nakama.",
    title: "Require MFA to sign in?",
  },
  roles: {
    confirmLabel: "Require",
    description:
      "Users in the added roles must set up an authenticator before they can use Nakama.",
    title: "Require MFA for more roles?",
  },
} as const;

type PendingConfirm = {
  input: PolicyUpdate;
  kind: keyof typeof CONFIRMS;
} | null;

function RolesPicker({
  disabled,
  enforcedRoles,
  onChange,
}: {
  disabled: boolean;
  enforcedRoles: OrgRole[];
  onChange: (next: OrgRole[]) => void;
}) {
  const selected = new Set(enforcedRoles);

  const label =
    enforcedRoles.length === roles.length
      ? "All roles"
      : roles
          .flatMap((role) => (selected.has(role.value) ? [role.label] : []))
          .join(", ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Required for: ${label}`}
        className="flex h-9 w-44 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
      >
        <span className="truncate">{label}</span>
        <ArrowDown01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        {roles.map(({ label: roleLabel, value }) => (
          <DropdownMenuCheckboxItem
            checked={selected.has(value)}
            closeOnClick={false}
            // At least one role stays selected.
            disabled={selected.has(value) && selected.size === 1}
            key={value}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...enforcedRoles, value]
                  : enforcedRoles.filter((role) => role !== value)
              )
            }
          >
            {roleLabel}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PlatformMfaSettingsCard() {
  const [policy, setPolicy] = useState<MfaPolicyResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  useEffect(() => {
    client
      .getMfaPolicy()
      .then(setPolicy)
      .catch((err) => setError(formatError(err)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!savedHint) {
      return;
    }

    const timeout = window.setTimeout(() => setSavedHint(null), 2500);

    return () => window.clearTimeout(timeout);
  }, [savedHint]);

  // Saves run one at a time, in order. Controls stay enabled so keyboard
  // focus is not lost, and a change made during a save waits its turn.
  const saveQueue = useRef<Promise<void> | null>(null);
  const queuedSaves = useRef(0);

  function update(input: PolicyUpdate): Promise<void> {
    setError(null);
    setSavedHint(null);
    setBusy(true);
    // Show the change now, so the next change builds on it.
    setPolicy((current) => (current ? { ...current, ...input } : current));
    queuedSaves.current += 1;

    const run = (saveQueue.current ?? Promise.resolve()).then(async () => {
      try {
        const saved = await client.updateMfaPolicy(input);

        // An older response must not undo a change still in the queue.
        if (queuedSaves.current === 1) {
          setPolicy(saved);
          setSavedHint("Saved");
        }
      } catch (err) {
        setError(formatError(err));

        // Show what the server has, not the change that failed.
        try {
          setPolicy(await client.getMfaPolicy());
        } catch {
          // The save error above is already shown.
        }
      } finally {
        queuedSaves.current -= 1;

        if (queuedSaves.current === 0) {
          setBusy(false);
        }
      }
    });

    saveQueue.current = run;

    return run;
  }

  return (
    <Card aria-busy={busy || undefined} className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              MFA for all users
            </p>
            {savedHint ? (
              <p
                className="text-emerald-700 text-xs dark:text-emerald-300"
                role="status"
              >
                {savedHint}
              </p>
            ) : null}
          </div>
          <Switch
            aria-label="MFA for all users"
            checked={policy?.enabled === true}
            disabled={policy === null}
            onCheckedChange={(enabled) => {
              if (enabled) {
                void update({ enabled, required: policy?.required });
              } else {
                setPendingConfirm({
                  input: { enabled: false, required: false },
                  kind: "disable",
                });
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <p className="font-medium text-foreground text-sm">
            Require for sign-in
          </p>
          <Switch
            aria-label="Require for sign-in"
            checked={policy?.required === true}
            disabled={policy?.enabled !== true}
            onCheckedChange={(required) => {
              if (required) {
                setPendingConfirm({ input: { required }, kind: "require" });
              } else {
                void update({ required });
              }
            }}
          />
        </div>
        {/* Roles show before Require turns on, so the admin picks who is locked out first. */}
        {policy?.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium text-foreground text-sm">
                Required for
              </p>
              <p className="text-muted-foreground text-xs">
                Platform admins always need it.
              </p>
            </div>
            <RolesPicker
              disabled={policy === null}
              enforcedRoles={policy.enforcedRoles}
              onChange={(enforcedRoles) => {
                // Adding a role while Require is on locks those users out.
                const added =
                  enforcedRoles.length > policy.enforcedRoles.length;

                if (policy.required && added) {
                  setPendingConfirm({
                    input: { enforcedRoles },
                    kind: "roles",
                  });
                } else {
                  void update({ enforcedRoles });
                }
              }}
            />
          </div>
        ) : null}
        {error ? (
          <p className="px-4 py-3 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
      {pendingConfirm ? (
        <ConfirmDialog
          {...CONFIRMS[pendingConfirm.kind]}
          onClose={() => setPendingConfirm(null)}
          onConfirm={() => update(pendingConfirm.input)}
        />
      ) : null}
    </Card>
  );
}
