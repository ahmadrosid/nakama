import { useEffect, useState } from "react";
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
import { CodingHarnessHarnessRow } from "@/components/coding-harness-harness-row";
import { CodingHarnessSettingsFooter } from "@/components/coding-harness-settings-footer";
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
      { selectedHarnessId },
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
    return <CodingHarnessSettingsSkeleton embedded={embedded} />;
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
          {settings.harnesses.map((harness) => (
            <CodingHarnessHarnessRow
              key={harness.id}
              harness={harness}
              selected={selectedHarnessId === harness.id}
              expanded={expandedHarnessId === harness.id}
              installingId={installingId}
              installProgress={installProgress}
              onSelect={() => selectHarness(harness.id)}
              onToggleExpanded={() => toggleExpanded(harness.id)}
              onCopyInstallCommand={(command) => {
                void copyInstallCommand(command);
              }}
              onInstall={() => handleInstall(harness.id, harness.name)}
            />
          ))}
        </div>

        <CodingHarnessSettingsFooter
          verifyPending={verifyMutation.isPending}
          savePending={saveMutation.isPending}
          selectedHarnessId={selectedHarnessId}
          onRefresh={handleRefresh}
          onVerify={handleVerify}
          onSave={handleSave}
        />
      </CardContent>
    </Card>
  );
}

function CodingHarnessSettingsSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <Card className={cn("shadow-none", embedded ? "border-border" : "border-0 shadow-none")}>
      <CardContent
        className="space-y-5 p-6"
        aria-busy="true"
        aria-label="Loading coding agents"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton-shimmer h-5 w-28 rounded" />
            <div className="skeleton-shimmer h-4 w-full max-w-sm rounded" />
          </div>
        </div>

        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-border px-4 py-3.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="skeleton-shimmer h-4 w-24 rounded" />
                    <div className="skeleton-shimmer h-5 w-28 rounded-full" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <div className="skeleton-shimmer h-5 w-[5.5rem] rounded-full" />
                    <div className="skeleton-shimmer h-5 w-[7.25rem] rounded-full" />
                    <div className="skeleton-shimmer h-5 w-[6.25rem] rounded-full" />
                  </div>
                </div>
                <div className="skeleton-shimmer size-7 shrink-0 rounded-md" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="skeleton-shimmer h-3 w-full max-w-xs rounded" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="skeleton-shimmer h-9 w-24 rounded-md" />
            <div className="skeleton-shimmer h-9 w-36 rounded-md" />
          </div>
        </div>
      </CardContent>
    </Card>
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
