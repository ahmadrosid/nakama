import { Button } from "@nakama/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import {
  Alert02Icon,
  Link01Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from "hugeicons-react";
import { useState } from "react";
import { IntegrationCardShell } from "@/components/integration-settings.shared";
import {
  useErrorTrackingSettings,
  useSaveErrorTrackingSettings,
  useSendErrorTrackingTest,
} from "@/hooks/use-app-queries";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { formatError } from "@/lib/client";

export function ErrorTrackingSettingsCard() {
  const {
    data: settings,
    isLoading,
    error: loadError,
  } = useErrorTrackingSettings();

  const saveMutation = useSaveErrorTrackingSettings();
  const testMutation = useSendErrorTrackingTest();
  const [dsn, setDsn] = useState("");
  const [showDsn, setShowDsn] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <IntegrationCardShell busyLabel="Loading error tracking settings">
        <div className="space-y-2 p-5">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-9 w-full rounded bg-muted" />
        </div>
      </IntegrationCardShell>
    );
  }

  const configured = settings?.configured === true;
  const lastTest = settings?.lastTest ?? null;
  const testFailed = configured && lastTest?.delivered === false;
  const editing = !configured || replacing;
  const errorMessage = formError ?? (loadError ? formatError(loadError) : null);

  async function save(next: string) {
    setFormError(null);

    try {
      await saveMutation.mutateAsync({ dsn: next });
      setDsn("");
      setReplacing(false);
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  async function handleTest() {
    setFormError(null);

    try {
      await testMutation.mutateAsync();
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  const sendTestLabel = testMutation.isPending ? (
    <Spinner className="size-4" />
  ) : null;

  return (
    <div className="space-y-4">
      {/* The result leads the page: a saved DSN that rejects events is the state
          an operator must not miss. */}
      {testFailed ? (
        <div
          className="flex flex-wrap items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5"
          role="alert"
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <Alert02Icon aria-hidden className="size-5" />
          </div>
          <div className="min-w-0 flex-[1_1_16rem] space-y-1">
            <p className="font-medium text-foreground text-sm">
              Test event not delivered
            </p>
            <p className="text-muted-foreground text-sm [text-wrap:pretty]">
              The ingest rejected the event or could not be reached. Check the
              DSN.
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={testMutation.isPending}
            onClick={() => void handleTest()}
            size="sm"
            type="button"
            variant="outline"
          >
            {sendTestLabel ?? (
              <>
                <RefreshIcon aria-hidden className="size-4" />
                Send again
              </>
            )}
          </Button>
        </div>
      ) : null}

      <IntegrationCardShell>
        {editing ? (
          <div className="space-y-2 p-5">
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-foreground text-sm">
                Sentry-compatible DSN
              </p>
              <p className="text-muted-foreground text-sm [text-wrap:pretty]">
                Works with Sentry, GlitchTip, Bugsink, Rustrak and a self-hosted
                Sentry.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <InputGroup className="h-9 min-w-0 flex-1">
                <InputGroupInput
                  aria-label="Sentry-compatible DSN"
                  autoComplete="off"
                  disabled={saveMutation.isPending}
                  id="error-tracking-dsn"
                  onChange={(event) => {
                    setDsn(event.target.value);

                    if (formError) {
                      setFormError(null);
                    }
                  }}
                  placeholder="https://<key>@sentry.example.com/42"
                  type={showDsn ? "text" : "password"}
                  value={dsn}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label={showDsn ? "Hide DSN" : "Show DSN"}
                    className="relative before:absolute before:-inset-2 before:content-['']"
                    onClick={() => setShowDsn((current) => !current)}
                    size="icon-xs"
                    type="button"
                  >
                    {showDsn ? (
                      <ViewOffIcon className="size-4" />
                    ) : (
                      <ViewIcon className="size-4" />
                    )}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <Button
                className="min-w-[4.5rem] shrink-0"
                disabled={saveMutation.isPending || !dsn.trim()}
                onClick={() => void save(dsn.trim())}
                size="sm"
                type="button"
              >
                {saveMutation.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  "Save"
                )}
              </Button>
              {replacing ? (
                <Button
                  className="shrink-0"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    setReplacing(false);
                    setDsn("");
                    setFormError(null);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-[1_1_16rem] space-y-1">
              <p className="text-muted-foreground text-sm">
                Sentry-compatible DSN
              </p>
              <p className="truncate font-mono text-foreground text-sm">
                {settings?.dsnMasked}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="shrink-0"
                onClick={() => setReplacing(true)}
                size="sm"
                type="button"
              >
                Replace DSN
              </Button>
              {/* Without this the only way to learn the DSN is wrong is to wait
                  for a real crash. The failure banner carries its own retry. */}
              {testFailed ? null : (
                <Button
                  className="shrink-0"
                  disabled={testMutation.isPending}
                  onClick={() => void handleTest()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {sendTestLabel ?? "Send test event"}
                </Button>
              )}
              <Button
                className="shrink-0"
                disabled={saveMutation.isPending}
                onClick={() => void save("")}
                size="sm"
                type="button"
                variant="outline"
              >
                {saveMutation.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  "Turn off"
                )}
              </Button>
            </div>
          </div>
        )}

        {editing ? null : (
          <dl className="grid grid-cols-1 gap-4 border-border border-t px-5 py-4 text-sm sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-muted-foreground">Saved</dt>
              <dd className="text-foreground">
                {settings?.savedAt
                  ? formatSessionTimestamp(settings.savedAt)
                  : "—"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Last test</dt>
              <dd
                className={
                  testFailed
                    ? "text-destructive"
                    : lastTest
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-foreground"
                }
              >
                {lastTest
                  ? `${lastTest.delivered ? "Delivered" : "Failed"} · ${formatSessionRelativeTime(lastTest.at)}`
                  : "Not sent yet"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Works with</dt>
              <dd className="text-foreground">
                Sentry, GlitchTip, Bugsink, Rustrak
              </dd>
            </div>
          </dl>
        )}

        {errorMessage ? (
          <p className="px-5 pb-4 text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="border-border border-t px-5 py-3">
          <a
            className="inline-flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
            href="https://docs.sentry.io/concepts/key-terms/dsn-explainer/"
            rel="noreferrer"
            target="_blank"
          >
            <Link01Icon aria-hidden className="size-3.5 shrink-0" />
            <span>
              Find your DSN:{" "}
              <span className="font-medium text-primary">
                Project Settings → Client Keys
              </span>
            </span>
          </a>
        </div>
      </IntegrationCardShell>
    </div>
  );
}
