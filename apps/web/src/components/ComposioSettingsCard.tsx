import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import { LockIcon, ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useState } from "react";
import { IntegrationCardShell } from "@/components/integration-settings.shared";
import {
  useComposioSettings,
  useSaveComposioSettings,
} from "@/hooks/use-composio";
import { client, formatError } from "@/lib/client";

const COMPOSIO_KEY_INPUT_ID = "composio-api-key";

const COMPOSIO_REPLACE_ID = "composio-replace-key";

const COMPOSIO_DASHBOARD_URL = "https://dashboard.composio.dev";

type ComposioStatus = "connected" | "missing" | "unreachable";

const STATUS_BADGES: Record<
  ComposioStatus,
  { className: string; dot: string; label: string }
> = {
  connected: {
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
    dot: "bg-emerald-500",
    label: "Connected",
  },
  missing: {
    className: "border-border bg-background text-muted-foreground",
    dot: "bg-muted-foreground/60",
    label: "Not set up",
  },
  unreachable: {
    className:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
    dot: "bg-amber-500",
    label: "Can't connect",
  },
};

function ComposioStatusBadge({ status }: { status: ComposioStatus }) {
  const badge = STATUS_BADGES[status];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium text-xs ${badge.className}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${badge.dot}`} />
      {badge.label}
    </span>
  );
}

function useComposioSettingsForm() {
  const {
    data: settings,
    isLoading,
    isFetching,
    error: loadError,
    refetch,
  } = useComposioSettings();

  const saveMutation = useSaveComposioSettings();
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function focusReplace() {
    // Runs after React swaps the editor back to the key row.
    window.requestAnimationFrame(() =>
      document.getElementById(COMPOSIO_REPLACE_ID)?.focus()
    );
  }

  async function save() {
    const trimmed = apiKey.trim();

    if (!trimmed) {
      return;
    }

    setFormError(null);

    try {
      await saveMutation.mutateAsync({ apiKey: trimmed });
      setApiKey("");
      setEditing(false);
      focusReplace();
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  async function manageKey(action: "clear" | "use-stored") {
    setFormError(null);

    try {
      await client.manageSettingSecret("composio", action);
      await refetch();
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  return {
    apiKey,
    cancel: () => {
      setApiKey("");
      setFormError(null);
      setEditing(false);
      focusReplace();
    },
    editing,
    error: formError ?? (loadError ? formatError(loadError) : null),
    isFetching,
    isLoading,
    manageKey,
    replace: () => {
      setFormError(null);
      setEditing(true);
    },
    retry: () => void refetch(),
    save,
    savePending: saveMutation.isPending,
    setApiKey: (value: string) => {
      setApiKey(value);
      setFormError(null);
    },
    settings,
  };
}

type ComposioForm = ReturnType<typeof useComposioSettingsForm>;

function ComposioKeyEditor({
  canCancel,
  form,
}: {
  canCancel: boolean;
  form: ComposioForm;
}) {
  const [showKey, setShowKey] = useState(false);
  const canSave = form.apiKey.trim().length > 0;

  return (
    <div className="space-y-2 px-4 py-3">
      <label
        className="block font-medium text-foreground text-sm"
        htmlFor={COMPOSIO_KEY_INPUT_ID}
      >
        {canCancel ? "New project API key" : "Project API key"}
      </label>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.save();
        }}
      >
        <InputGroup className="h-9 min-w-[12rem] flex-1">
          <InputGroupInput
            autoComplete="off"
            // Focus only when the user asked to replace, never on page load.
            autoFocus={canCancel}
            id={COMPOSIO_KEY_INPUT_ID}
            onChange={(event) => form.setApiKey(event.target.value)}
            placeholder="Paste a project API key"
            readOnly={form.savePending}
            type={showKey ? "text" : "password"}
            value={form.apiKey}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={showKey ? "Hide key" : "Show key"}
              className="relative before:absolute before:-inset-2 before:content-['']"
              onClick={() => setShowKey((current) => !current)}
              size="icon-xs"
              type="button"
            >
              {showKey ? (
                <ViewOffIcon className="size-4" />
              ) : (
                <ViewIcon className="size-4" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {canCancel ? (
          <Button
            onClick={form.cancel}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        ) : null}
        <Button aria-disabled={!canSave || undefined} size="sm" type="submit">
          {form.savePending ? <Spinner className="size-4" /> : "Save key"}
        </Button>
      </form>
      <p className="text-muted-foreground text-xs">
        Use the project key, not the MCP consumer key.
        {canCancel ? " The current key keeps working until you save." : ""}{" "}
        <a
          className="font-medium text-primary underline-offset-2 hover:underline"
          href={COMPOSIO_DASHBOARD_URL}
          rel="noreferrer"
          target="_blank"
        >
          Get a key
        </a>
      </p>
      {form.settings?.source === "missing" && form.settings.savedAvailable ? (
        <Button
          onClick={() => void form.manageKey("use-stored")}
          size="sm"
          type="button"
          variant="outline"
        >
          Use saved key
        </Button>
      ) : null}
    </div>
  );
}

function ComposioKeyRow({
  form,
  reachable,
}: {
  form: ComposioForm;
  reachable: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-[1_1_20rem] space-y-0.5">
        <p className="font-medium text-foreground text-sm">Project API key</p>
        {reachable ? (
          <p className="text-muted-foreground text-xs">Saved in settings</p>
        ) : (
          <p className="text-amber-800 text-xs dark:text-amber-200">
            Composio rejected the saved key. Check that it is a project key, not
            the MCP consumer key.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        {reachable ? null : (
          <Button
            aria-disabled={form.isFetching || undefined}
            onClick={() => !form.isFetching && form.retry()}
            size="sm"
            type="button"
            variant="outline"
          >
            {form.isFetching ? <Spinner className="size-4" /> : "Try again"}
          </Button>
        )}
        <Button
          id={COMPOSIO_REPLACE_ID}
          onClick={form.replace}
          size="sm"
          type="button"
          variant="outline"
        >
          Replace
        </Button>
        <Button
          onClick={() => setConfirmRemove(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          Remove
        </Button>
      </div>
      {confirmRemove ? (
        <ConfirmDialog
          confirmLabel="Remove key"
          description="Composio tools stop working in every organization until a new key is saved."
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => form.manageKey("clear")}
          title="Remove the Composio key?"
        />
      ) : null}
    </div>
  );
}

function ComposioEnvironmentRow() {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-foreground text-sm">Project API key</p>
        <p className="text-muted-foreground text-xs">
          Set on the server with{" "}
          <code className="font-mono">COMPOSIO_API_KEY</code>. Change it there.
        </p>
      </div>
      <LockIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

function ComposioKeyBody({ form }: { form: ComposioForm }) {
  const settings = form.settings;

  if (settings?.source === "environment") {
    return <ComposioEnvironmentRow />;
  }

  if (settings?.configured && !form.editing) {
    return (
      <ComposioKeyRow form={form} reachable={settings.composioReachable} />
    );
  }

  return (
    <ComposioKeyEditor canCancel={settings?.configured === true} form={form} />
  );
}

function composioStatus(form: ComposioForm): ComposioStatus {
  if (!form.settings?.configured) {
    return "missing";
  }

  return form.settings.composioReachable ? "connected" : "unreachable";
}

export function ComposioSettingsCard() {
  const form = useComposioSettingsForm();

  if (form.isLoading) {
    return (
      <IntegrationCardShell busyLabel="Loading Composio settings">
        <div className="flex items-center justify-between gap-4 border-border border-b px-4 py-3">
          <div className="skeleton-shimmer h-4 w-24 rounded" />
          <div className="skeleton-shimmer h-6 w-24 shrink-0 rounded-full" />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="skeleton-shimmer h-9 w-48 rounded" />
          <div className="skeleton-shimmer h-8 w-40 shrink-0 rounded-md" />
        </div>
      </IntegrationCardShell>
    );
  }

  return (
    <IntegrationCardShell>
      <div className="flex items-center justify-between gap-4 border-border border-b px-4 py-3">
        <p className="font-medium text-foreground text-sm">Composio</p>
        <ComposioStatusBadge status={composioStatus(form)} />
      </div>
      <ComposioKeyBody form={form} />
      {form.error ? (
        <p className="px-4 pb-3 text-destructive text-xs" role="alert">
          {form.error}
        </p>
      ) : null}
    </IntegrationCardShell>
  );
}
