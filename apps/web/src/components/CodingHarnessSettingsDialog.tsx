import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CodingHarnessStatus } from "@tinyclaw/core/contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  codingHarnessSettingsQueryOptions,
  useCodingHarnessSettings,
  useSaveCodingHarnessSettings,
} from "@/hooks/use-coding-harness-settings";
import { formatError } from "@/lib/client";

type DraftHarness = Pick<CodingHarnessStatus, "id" | "command" | "enabled">;

export function CodingHarnessSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useCodingHarnessSettings(open);
  const saveMutation = useSaveCodingHarnessSettings();
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [draftHarnesses, setDraftHarnesses] = useState<DraftHarness[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !settings) {
      return;
    }

    setSelectedHarnessId(settings.selectedHarnessId);
    setDraftHarnesses(
      settings.harnesses.map((harness) => ({
        id: harness.id,
        command: harness.command,
        enabled: harness.enabled,
      })),
    );
    setHint(null);
    setFormError(null);
  }, [open, settings]);

  const draftById = useMemo(
    () => new Map(draftHarnesses.map((harness) => [harness.id, harness])),
    [draftHarnesses],
  );

  function updateHarness(id: string, next: Partial<DraftHarness>) {
    setDraftHarnesses((current) =>
      current.map((harness) => (harness.id === id ? { ...harness, ...next } : harness)),
    );
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
        harnesses: draftHarnesses,
      },
      {
        onSuccess: (saved) => {
          setHint(
            saved.configured
              ? "Coding harness settings saved."
              : "Saved, but no selected harness is installed yet.",
          );
        },
        onError: (saveError) => {
          setFormError(formatError(saveError));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 pr-6">
            <div className="min-w-0 flex-1">
              <DialogTitle>Coding agent harnesses</DialogTitle>
              <DialogDescription className="text-xs">
                Choose which installed coding agent TinyClaw should use for delegated code work.
              </DialogDescription>
            </div>
            {settings?.configured ? (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                Ready
              </span>
            ) : null}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <Spinner />
            Loading coding harness settings…
          </div>
        ) : error ? (
          <div className="px-4 py-4 text-sm text-destructive" role="alert">
            {formatError(error)}
          </div>
        ) : settings ? (
          <>
            <div className="space-y-4 px-4 py-4">
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
                  const draft = draftById.get(harness.id);
                  const enabled = draft?.enabled ?? harness.enabled;
                  const command = draft?.command ?? harness.command;

                  return (
                    <section
                      key={harness.id}
                      className="rounded-md border border-border bg-card p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium text-foreground">{harness.name}</h3>
                            <span
                              className={
                                harness.installed
                                  ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
                                  : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300"
                              }
                            >
                              {harness.installed ? "Installed" : "Not installed"}
                            </span>
                            {selectedHarnessId === harness.id ? (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                Selected
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{harness.installHint}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={selectedHarnessId === harness.id ? "default" : "outline"}
                            onClick={() => setSelectedHarnessId(harness.id)}
                          >
                            Use by default
                          </Button>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            Enabled
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) =>
                                updateHarness(harness.id, { enabled: checked })
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <FormField
                          id={`coding-harness-command-${harness.id}`}
                          label="Command"
                          density="compact"
                        >
                          <Input
                            value={command}
                            onChange={(event) =>
                              updateHarness(harness.id, { command: event.target.value })
                            }
                            placeholder={harness.command}
                          />
                        </FormField>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="gap-2 border-t border-border bg-background sm:justify-between">
              <div className="p-4">
                <Button type="button" variant="outline" onClick={handleRefresh}>
                  Refresh status
                </Button>
              </div>
              <div className="flex items-center gap-2 p-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Spinner className="size-4" /> : "Save"}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
