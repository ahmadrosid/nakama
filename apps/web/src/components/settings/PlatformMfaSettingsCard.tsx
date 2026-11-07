import type { MfaPolicyResponse, OrgRole } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { cn } from "@nakama/ui/utils";
import { useEffect, useRef, useState } from "react";
import { client, formatError } from "@/lib/client";

const roles: Array<{ label: string; value: OrgRole }> = [
  { label: "Admins", value: "admin" },
  { label: "Members", value: "member" },
];

type Mode = "off" | "optional" | "required";

const modes: Array<{ description: string; label: string; value: Mode }> = [
  { description: "Nobody is asked for a code.", label: "Off", value: "off" },
  {
    description: "Users can add an authenticator in their own settings.",
    label: "Optional",
    value: "optional",
  },
  {
    description: "Chosen roles must set one up before they can use Nakama.",
    label: "Required",
    value: "required",
  },
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

  const mode: Mode = policy?.enabled
    ? policy.required
      ? "required"
      : "optional"
    : "off";

  function select(next: Mode) {
    if (!policy || next === mode) {
      return;
    }

    if (next === "off") {
      setPendingConfirm({
        input: { enabled: false, required: false },
        kind: "disable",
      });
    } else if (next === "optional") {
      void update(policy.enabled ? { required: false } : { enabled: true });
    } else {
      setPendingConfirm({
        input: policy.enabled
          ? { required: true }
          : { enabled: true, required: true },
        kind: "require",
      });
    }
  }

  function toggleRole(role: OrgRole) {
    if (!policy) {
      return;
    }

    const selected = policy.enforcedRoles.includes(role);

    const enforcedRoles = selected
      ? policy.enforcedRoles.filter((value) => value !== role)
      : [...policy.enforcedRoles, role];

    // Adding a role while Required is on locks those users out.
    if (selected) {
      void update({ enforcedRoles });
    } else {
      setPendingConfirm({ input: { enforcedRoles }, kind: "roles" });
    }
  }

  // The roles show only under Required, so its confirm names who is locked out.
  const roleNames = roles
    .flatMap(({ label, value }) =>
      policy?.enforcedRoles.includes(value) ? [label] : []
    )
    .join(" and ");

  const confirm = pendingConfirm
    ? pendingConfirm.kind === "require"
      ? {
          ...CONFIRMS.require,
          description: `${roleNames} must set up an authenticator before they can use Nakama. Platform admins always need it.`,
        }
      : CONFIRMS[pendingConfirm.kind]
    : null;

  return (
    <Card aria-busy={busy || undefined} className="w-full shadow-none">
      <CardContent className="p-0">
        <fieldset className="m-0 min-w-0 border-0 p-0 pb-2">
          <legend className="float-left flex w-full items-center gap-2 px-4 pt-3 pb-1">
            <span className="font-medium text-foreground text-sm">
              Two-factor sign-in
            </span>
            {savedHint ? (
              <span
                className="text-emerald-700 text-xs dark:text-emerald-300"
                role="status"
              >
                {savedHint}
              </span>
            ) : null}
          </legend>
          {modes.map((option) => {
            const checked = mode === option.value;

            return (
              <div
                className={cn("clear-both", checked && "bg-muted/60")}
                key={option.value}
              >
                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5">
                  <input
                    checked={checked}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    disabled={policy === null}
                    name="platform-mfa-mode"
                    onChange={() => select(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium text-foreground text-sm">
                      {option.label}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {option.description}
                    </span>
                  </span>
                </label>
                {option.value === "required" && checked && policy ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 pr-4 pb-3 pl-11">
                    <p className="text-muted-foreground text-sm">
                      <span className="text-foreground">For</span> (platform
                      admins always)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {roles.map(({ label, value }) => {
                        const selected = policy.enforcedRoles.includes(value);

                        return (
                          <button
                            aria-pressed={selected}
                            className={cn(
                              "h-8 rounded-full border px-3 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input bg-background text-foreground hover:bg-muted"
                            )}
                            // At least one role stays selected.
                            disabled={
                              selected && policy.enforcedRoles.length === 1
                            }
                            key={value}
                            onClick={() => toggleRole(value)}
                            type="button"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        {error ? (
          <p
            className="border-border border-t px-4 py-3 text-destructive text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </CardContent>
      {pendingConfirm && confirm ? (
        <ConfirmDialog
          {...confirm}
          onClose={() => setPendingConfirm(null)}
          onConfirm={() => update(pendingConfirm.input)}
        />
      ) : null}
    </Card>
  );
}
