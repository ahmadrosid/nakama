import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  LaptopMinimalCheckIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  codingHarnessSettingsQueryOptions,
  useCodingHarnessSettings,
  useInstallCodingHarness,
  useSaveCodingHarnessSettings,
  useVerifyCodingHarness,
} from "@/hooks/use-coding-harness-settings";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

export function CodingHarnessSettingsPanel({
  embedded = false,
  enabled = true,
}: {
  embedded?: boolean;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useCodingHarnessSettings(enabled);
  const saveMutation = useSaveCodingHarnessSettings();
  const verifyMutation = useVerifyCodingHarness();
  const installMutation = useInstallCodingHarness();
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setSelectedHarnessId(settings.selectedHarnessId ?? settings.activeHarnessId);
    setHint(null);
    setFormError(null);
  }, [settings]);

  const selectedHarness =
    settings?.harnesses.find((harness) => harness.id === selectedHarnessId) ?? null;

  const summary = useMemo(() => {
    if (!selectedHarness) {
      return {
        tone: "warn",
        label: "Pick an agent",
        body: "Choose which coding agent Nakama should use on this machine.",
      };
    }

    if (!selectedHarness.installed) {
      return {
        tone: "warn",
        label: `Install ${selectedHarness.name}`,
        body: `${selectedHarness.name} is not installed on this machine yet.`,
      };
    }

    if (verifyMutation.isPending) {
      return {
        tone: "neutral",
        label: "Checking readiness",
        body: `Checking whether ${selectedHarness.name} is ready to run.`,
      };
    }

    if (selectedHarness.ready) {
      return {
        tone: "ok",
        label: `${selectedHarness.name} is ready`,
        body: selectedHarness.statusMessage ?? "Nakama can use this coding agent now.",
      };
    }

    if (selectedHarness.nextStep === "login") {
      return {
        tone: "warn",
        label: `Login required for ${selectedHarness.name}`,
        body: selectedHarness.statusMessage ?? `${selectedHarness.name} still needs authentication.`,
      };
    }

    return {
      tone: "warn",
      label: "Run readiness check",
      body: "Nakama still needs to confirm this coding agent can actually run.",
    };
  }, [selectedHarness, verifyMutation.isPending]);

  function handleRefresh() {
    setHint(null);
    setFormError(null);
    void queryClient.invalidateQueries({
      queryKey: codingHarnessSettingsQueryOptions.queryKey,
    });
  }

  function handleSave() {
    setHint(null);
    setFormError(null);

    saveMutation.mutate(
      {
        selectedHarnessId,
      },
      {
        onSuccess: (saved) => {
          const selected = saved.harnesses.find((harness) => harness.id === selectedHarnessId);
          setHint(
            selected
              ? `${selected.name} selected. Nakama will use it for coding delegation after the readiness check passes.`
              : "Coding agent selection saved.",
          );
        },
        onError: (saveError) => {
          setFormError(formatError(saveError));
        },
      },
    );
  }

  function handleVerify() {
    if (!selectedHarnessId) {
      setFormError("Pick a coding agent first.");
      return;
    }

    setHint(null);
    setFormError(null);

    verifyMutation.mutate(
      { harnessId: selectedHarnessId },
      {
        onSuccess: (result) => {
          if (result.ready) {
            setHint(result.statusMessage ?? `${result.name ?? "Selected agent"} is ready.`);
            return;
          }

          setFormError(result.error ?? "Could not verify the selected coding agent.");
        },
        onError: (verifyError) => {
          setFormError(formatError(verifyError));
        },
      },
    );
  }

  async function copyInstallCommand(command: string) {
    await navigator.clipboard.writeText(command);
    setHint("Install command copied.");
  }

  function handleInstall(harnessId: string, name: string) {
    setHint(null);
    setFormError(null);
    setInstallingId(harnessId);
    setInstallProgress(null);

    installMutation.mutate(
      {
        harnessId,
        onProgress: (message) => {
          setInstallProgress(message);
        },
      },
      {
        onSuccess: (status) => {
          setInstallingId(null);
          setInstallProgress(null);
          if (status.installed) {
            setHint(`${name} installed successfully.`);
          } else {
            setFormError(
              status.statusMessage ??
                `${name} did not finish installing. Check the command output.`,
            );
          }
        },
        onError: (installError) => {
          setInstallingId(null);
          setInstallProgress(null);
          setFormError(formatError(installError));
        },
      },
    );
  }

  if (isLoading) {
    return (
      <Card className="shadow-none">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Spinner />
          Loading coding agent setup…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-4 text-sm text-destructive" role="alert">
          {formatError(error)}
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return null;
  }

  return (
    <Card className={cn("shadow-none", embedded ? "border-border" : "border-0 shadow-none")}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">Coding agents</p>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  summary.tone === "ok"
                    ? "bg-emerald-500/10 text-emerald-300"
                    : summary.tone === "neutral"
                      ? "bg-muted text-muted-foreground"
                      : "bg-amber-500/10 text-amber-300",
                )}
              >
                {summary.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Nakama can hand off coding tasks to a CLI agent on this server.
            </p>
          </div>
          {!embedded ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              render={<Link to="/integrations?section=coding-agents" />}
            >
              Open in Integrations
            </Button>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-sm font-medium text-foreground">{summary.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{summary.body}</p>
        </div>

        {formError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        {hint ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {hint}
          </p>
        ) : null}

        <div className="space-y-2">
          {settings.harnesses.map((harness) => {
            const selected = selectedHarnessId === harness.id;

            return (
              <button
                key={harness.id}
                type="button"
                className={cn(
                  "w-full rounded-lg border p-4 text-left transition-colors",
                  selected
                    ? "border-foreground/20 bg-muted/40"
                    : "border-border bg-card hover:border-foreground/10 hover:bg-muted/20",
                )}
                onClick={() => setSelectedHarnessId(harness.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{harness.name}</span>
                      {harness.version ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {harness.version}
                        </span>
                      ) : null}
                      {selected ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <StatusChip
                        icon={<LaptopMinimalCheckIcon className="size-3.5" />}
                        tone={harness.installed ? "ok" : "warn"}
                        label={harness.installed ? "Installed" : "Not installed"}
                      />
                      <StatusChip
                        icon={<KeyRoundIcon className="size-3.5" />}
                        tone={
                          !harness.installed
                            ? "muted"
                            : harness.authenticated === true
                              ? "ok"
                              : harness.authenticated === false
                                ? "warn"
                                : "muted"
                        }
                        label={
                          !harness.installed
                            ? "Waiting for install"
                            : harness.authenticated === true
                              ? "Logged in"
                              : harness.authenticated === false
                                ? "Needs login"
                                : "Login not checked"
                        }
                      />
                      <StatusChip
                        icon={<CheckCircle2Icon className="size-3.5" />}
                        tone={harness.ready ? "ok" : "muted"}
                        label={harness.ready ? "Ready" : "Not ready yet"}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {!harness.installed
                        ? harness.installHint
                        : harness.statusMessage ?? "Run the readiness check to confirm login."}
                    </p>
                  </div>
                </div>

                {!harness.installed ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                        {harness.installCommand}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyInstallCommand(harness.installCommand);
                        }}
                      >
                        <CopyIcon className="size-3.5" />
                        Copy install
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleInstall(harness.id, harness.name);
                        }}
                        disabled={installingId === harness.id}
                      >
                        {installingId === harness.id ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <DownloadIcon className="size-3.5" />
                        )}
                        {installingId === harness.id ? "Installing…" : "Install"}
                      </Button>
                    </div>
                    {installingId === harness.id && installProgress ? (
                      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {installProgress}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Nakama should only enable code delegation after the selected agent is ready.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={handleRefresh}>
              Check again
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleVerify}
              disabled={verifyMutation.isPending || !selectedHarnessId}
            >
              {verifyMutation.isPending ? <Spinner className="size-4" /> : "Run readiness check"}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending || !selectedHarnessId}
            >
              {saveMutation.isPending ? <Spinner className="size-4" /> : "Save selected agent"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusChip({
  icon,
  tone,
  label,
}: {
  icon: ReactNode;
  tone: "ok" | "warn" | "muted";
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
        tone === "ok"
          ? "bg-emerald-500/10 text-emerald-300"
          : tone === "warn"
            ? "bg-amber-500/10 text-amber-300"
            : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export function CodingHarnessSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Coding agents</DialogTitle>
          <DialogDescription className="text-xs">
            Pick an agent, make sure it is installed and logged in, then Nakama can enable code delegation.
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <CodingHarnessSettingsPanel enabled={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
