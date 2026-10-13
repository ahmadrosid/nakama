import type { ErrorTrackingSettingsResponse } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { buttonVariants } from "@nakama/ui/button-variants";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { cn } from "@nakama/ui/utils";
import {
  Alert02Icon,
  LinkSquare02Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from "hugeicons-react";
import { type ReactNode, useState } from "react";
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

  function handleDsnChange(value: string) {
    setDsn(value);

    if (formError) {
      setFormError(null);
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
        <TestFailedBanner
          onRetry={() => void handleTest()}
          pending={testMutation.isPending}
          pendingLabel={sendTestLabel}
        />
      ) : null}

      <IntegrationCardShell>
        {configured ? null : (
          <SetupSteps
            editor={
              <DsnEditor
                dsn={dsn}
                onDsnChange={handleDsnChange}
                onSave={() => void save(dsn.trim())}
                onToggleShow={() => setShowDsn((current) => !current)}
                saving={saveMutation.isPending}
                showDsn={showDsn}
              />
            }
          />
        )}

        {configured && replacing ? (
          <div className="p-5">
            <DsnEditor
              dsn={dsn}
              onCancel={() => {
                setReplacing(false);
                setDsn("");
                setFormError(null);
              }}
              onDsnChange={handleDsnChange}
              onSave={() => void save(dsn.trim())}
              onToggleShow={() => setShowDsn((current) => !current)}
              saving={saveMutation.isPending}
              showDsn={showDsn}
            />
          </div>
        ) : null}

        {configured && !replacing ? (
          <DsnSummary
            dsnMasked={settings?.dsnMasked}
            onReplace={() => setReplacing(true)}
            onTurnOff={() => void save("")}
            saving={saveMutation.isPending}
          />
        ) : null}

        {errorMessage ? (
          <p className="px-5 pb-4 text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {configured ? (
          <DsnFooter
            dashboardUrl={settings?.dashboardUrl}
            lastTest={lastTest}
            onTest={() => void handleTest()}
            savedAt={settings?.savedAt}
            testFailed={testFailed}
            testing={testMutation.isPending}
            testingLabel={sendTestLabel}
          />
        ) : null}
      </IntegrationCardShell>
    </div>
  );
}

function TestFailedBanner({
  onRetry,
  pending,
  pendingLabel,
}: {
  onRetry: () => void;
  pending: boolean;
  pendingLabel: ReactNode;
}) {
  return (
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
          The ingest rejected the event or could not be reached. Check the DSN.
        </p>
      </div>
      <Button
        className="shrink-0"
        disabled={pending}
        onClick={onRetry}
        size="sm"
        type="button"
        variant="outline"
      >
        {pendingLabel ?? (
          <>
            <RefreshIcon aria-hidden className="size-4" />
            Send again
          </>
        )}
      </Button>
    </div>
  );
}

const DSN_HELP_URL = "https://docs.sentry.io/concepts/key-terms/dsn-explainer/";

function DsnHelp() {
  return (
    <p className="text-muted-foreground text-sm [text-wrap:pretty]">
      Works with Sentry, GlitchTip, Bugsink, Rustrak. Find it in{" "}
      <a
        className="font-medium text-primary hover:underline"
        href={DSN_HELP_URL}
        rel="noreferrer"
        target="_blank"
      >
        Project Settings → Client Keys
      </a>
    </p>
  );
}

function SetupSteps({ editor }: { editor: ReactNode }) {
  return (
    <ol className="divide-y divide-border">
      <SetupStep number={1}>{editor}</SetupStep>
      <SetupStep muted number={2}>
        <p className="font-medium text-sm">Send a test event</p>
      </SetupStep>
      <SetupStep muted number={3}>
        <p className="font-medium text-sm">See it in your dashboard</p>
      </SetupStep>
    </ol>
  );
}

function SetupStep({
  children,
  muted,
  number,
}: {
  children: ReactNode;
  muted?: boolean;
  number: number;
}) {
  return (
    <li
      className={cn(
        "flex gap-4 p-5",
        muted ? "items-center text-muted-foreground" : "items-start"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full font-medium text-xs",
          muted ? "border border-border" : "bg-primary text-primary-foreground"
        )}
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function DsnEditor({
  dsn,
  onCancel,
  onDsnChange,
  onSave,
  onToggleShow,
  saving,
  showDsn,
}: {
  dsn: string;
  onCancel?: () => void;
  onDsnChange: (value: string) => void;
  onSave: () => void;
  onToggleShow: () => void;
  saving: boolean;
  showDsn: boolean;
}) {
  return (
    <div className="space-y-2">
      <label
        className="block font-medium text-foreground text-sm"
        htmlFor="error-tracking-dsn"
      >
        Sentry-compatible DSN
      </label>

      <div className="flex items-center gap-2">
        <InputGroup className="h-9 min-w-0 flex-1">
          <InputGroupInput
            autoComplete="off"
            disabled={saving}
            id="error-tracking-dsn"
            onChange={(event) => onDsnChange(event.target.value)}
            placeholder="https://<key>@sentry.example.com/42"
            type={showDsn ? "text" : "password"}
            value={dsn}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={showDsn ? "Hide DSN" : "Show DSN"}
              className="relative before:absolute before:-inset-2 before:content-['']"
              onClick={onToggleShow}
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
          disabled={saving || !dsn.trim()}
          onClick={onSave}
          size="sm"
          type="button"
        >
          {saving ? <Spinner className="size-4" /> : "Save"}
        </Button>
        {onCancel ? (
          <Button
            className="shrink-0"
            disabled={saving}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        ) : null}
      </div>

      <DsnHelp />
    </div>
  );
}

function DsnSummary({
  dsnMasked,
  onReplace,
  onTurnOff,
  saving,
}: {
  dsnMasked: string | null | undefined;
  onReplace: () => void;
  onTurnOff: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-2 p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="font-medium text-foreground text-sm">
          Sentry-compatible DSN
        </p>
        <div className="flex items-center gap-2 text-foreground text-sm">
          {saving ? <Spinner className="size-4" /> : null}
          <span>On</span>
          <Switch
            aria-label="Error tracking"
            checked
            disabled={saving}
            onCheckedChange={(next) => {
              if (!next) {
                onTurnOff();
              }
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <p className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border border-border bg-muted/40 px-3 font-mono text-foreground text-sm">
          {dsnMasked}
        </p>
        <Button
          className="shrink-0"
          onClick={onReplace}
          size="sm"
          type="button"
          variant="outline"
        >
          Replace
        </Button>
      </div>
      <DsnHelp />
    </div>
  );
}

function DsnFooter({
  dashboardUrl,
  lastTest,
  onTest,
  savedAt,
  testFailed,
  testing,
  testingLabel,
}: {
  dashboardUrl: string | null | undefined;
  lastTest: ErrorTrackingSettingsResponse["lastTest"];
  onTest: () => void;
  savedAt: string | null | undefined;
  testFailed: boolean;
  testing: boolean;
  testingLabel: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-border border-t bg-muted/40 px-5 py-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Saved</dt>
          <dd className="font-medium text-foreground">
            {savedAt ? formatSessionTimestamp(savedAt) : "—"}
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Last test</dt>
          <dd
            className={cn(
              "font-medium",
              testFailed
                ? "text-destructive"
                : lastTest
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground"
            )}
          >
            {lastTest
              ? `${lastTest.delivered ? "Delivered" : "Failed"} · ${formatSessionRelativeTime(lastTest.at)}`
              : "Not sent yet"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {dashboardUrl ? (
          <a
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            href={dashboardUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open dashboard
            <LinkSquare02Icon aria-hidden className="size-4" />
          </a>
        ) : null}
        {/* The failure banner carries its own retry, so the test button hides then. */}
        {testFailed ? null : (
          <Button disabled={testing} onClick={onTest} size="sm" type="button">
            {testingLabel ?? "Send test event"}
          </Button>
        )}
      </div>
    </div>
  );
}
