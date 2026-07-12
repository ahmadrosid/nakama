import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
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
  const [expandedHarnessId, setExpandedHarnessId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const nextSelected = settings.selectedHarnessId ?? settings.activeHarnessId;
    setSelectedHarnessId(nextSelected);
    setExpandedHarnessId(nextSelected);
    setHint(null);
    setFormError(null);
  }, [settings]);

  const selectedHarness =
    settings?.harnesses.find((harness) => harness.id === selectedHarnessId) ?? null;

  const summary = useMemo(() => {
    if (!selectedHarness) {
      return {
        tone: "warn" as const,
        label: "Pick an agent",
      };
    }

    if (!selectedHarness.installed) {
      return {
        tone: "warn" as const,
        label: `Install ${selectedHarness.name}`,
      };
    }

    if (verifyMutation.isPending) {
      return {
        tone: "neutral" as const,
        label: "Checking readiness",
      };
    }

    if (selectedHarness.ready) {
      return {
        tone: "ok" as const,
        label: `${selectedHarness.name} is ready`,
      };
    }

    if (selectedHarness.nextStep === "login") {
      return {
        tone: "warn" as const,
        label: `Login required for ${selectedHarness.name}`,
      };
    }

    return {
      tone: "warn" as const,
      label: "Run readiness check",
    };
  }, [selectedHarness, verifyMutation.isPending]);

  function selectHarness(harnessId: string) {
    setSelectedHarnessId(harnessId);
    setExpandedHarnessId(harnessId);
  }

  function toggleExpanded(harnessId: string) {
    setExpandedHarnessId((current) => (current === harnessId ? null : harnessId));
  }

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
              ? `${selected.name} selected. Nakama will use it for coding agent runs after the readiness check passes.`
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
            return;
          }

          if (status.nextStep === "login") {
            setHint(
              status.statusMessage ??
                `${name} is installed. Finish login on this server, then run readiness check.`,
            );
            return;
          }

          setHint(
            `${name} install finished, but Nakama could not confirm it is runnable yet. Click "Run readiness check" or install manually using the command above.`,
          );
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
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Spinner />
          Loading coding agent setup…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-6 text-sm text-destructive" role="alert">
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
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="type-section-title text-base">Coding agents</h2>
            <p className="text-sm text-muted-foreground">
              Nakama can hand off coding tasks to a CLI agent on this server.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                summary.tone === "ok"
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : summary.tone === "neutral"
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-accent-500/25 bg-accent-500/10 text-accent-500",
              )}
            >
              {summary.label}
            </span>
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

        <div className="space-y-3">
          {settings.harnesses.map((harness) => {
            const selected = selectedHarnessId === harness.id;
            const expanded = expandedHarnessId === harness.id;

            return (
              <div
                key={harness.id}
                className={cn(
                  "overflow-hidden rounded-lg border transition-colors",
                  selected
                    ? "border-primary/20 bg-primary/[0.06]"
                    : "border-border bg-background",
                )}
              >
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => selectHarness(harness.id)}
                  >
                    <BotIcon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        selected ? "text-primary" : "text-muted-foreground",
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />

                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{harness.name}</span>
                        {harness.version ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {harness.version}
                          </span>
                        ) : null}
                      </span>

                      <span className="flex flex-wrap gap-1.5 text-xs">
                        <StatusChip
                          icon={<LaptopMinimalCheckIcon className="size-3.5" />}
                          variant={harness.installed ? "solid-ok" : "solid-warn"}
                          label={harness.installed ? "Installed" : "Not installed"}
                        />
                        <StatusChip
                          icon={<KeyRoundIcon className="size-3.5" />}
                          variant={
                            !harness.installed
                              ? "muted"
                              : harness.authenticated === true
                                ? "ok"
                                : harness.authenticated === false
                                  ? "solid-warn"
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
                          icon={<CheckIcon className="size-3.5" />}
                          variant={harness.ready ? "ok" : "muted"}
                          label={harness.ready ? "Ready" : "Not ready yet"}
                        />
                      </span>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    {selected ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        <CheckIcon className="size-3.5" aria-hidden />
                        Selected
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      aria-expanded={expanded}
                      aria-label={expanded ? `Collapse ${harness.name}` : `Expand ${harness.name}`}
                      onClick={() => toggleExpanded(harness.id)}
                    >
                      {expanded ? (
                        <ChevronUpIcon className="size-4" aria-hidden />
                      ) : (
                        <ChevronDownIcon className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="border-t border-border/60 px-4 py-3 pl-11">
                    <p className="text-sm text-muted-foreground">
                      {!harness.installed
                        ? harness.installHint
                        : harness.statusMessage ?? "Run the readiness check to confirm login."}
                    </p>

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
                            onClick={() => {
                              void copyInstallCommand(harness.installCommand);
                            }}
                          >
                            <CopyIcon className="size-3.5" />
                            Copy install
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleInstall(harness.id, harness.name)}
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
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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
  variant,
  label,
}: {
  icon: ReactNode;
  variant: "solid-ok" | "ok" | "solid-warn" | "muted";
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
        variant === "solid-ok" && "bg-primary text-primary-foreground",
        variant === "ok" && "border border-primary/20 bg-primary/5 text-primary",
        variant === "solid-warn" && "bg-accent-500/15 text-accent-600 dark:text-accent-400",
        variant === "muted" && "bg-muted/80 text-muted-foreground",
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
            Pick an agent, make sure it is installed and logged in, then Nakama can enable code
            delegation.
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <CodingHarnessSettingsPanel enabled={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
