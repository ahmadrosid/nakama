import {
  parseSlackMemberIdInput,
  type SlackSettingsResponse,
} from "@nakama/core/contract";
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
import { Cancel01Icon, ViewIcon, ViewOffIcon } from "hugeicons-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
  PairingStepTile,
  SETTINGS_CARD_LOADING_SKELETON,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import {
  useRegenerateSlackHandshake,
  useSaveSlackSettings,
  useSlackSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";

const SLACK_NEW_APP_URL = "https://api.slack.com/apps?new_app=1";
/** Slack section of this server's API reference, which carries the setup guide. */
const SLACK_GUIDE_URL = "/docs#tag/slack";

/** Paste into "Create New App → From a manifest": Socket Mode, scopes and events preset. */
const SLACK_APP_MANIFEST = JSON.stringify(
  {
    display_information: { name: "Nakama" },
    features: {
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: { always_online: true, display_name: "Nakama" },
    },
    oauth_config: {
      scopes: {
        bot: [
          "channels:history",
          "chat:write",
          "groups:history",
          "im:history",
          "reactions:write",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ["message.channels", "message.groups", "message.im"],
      },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  },
  null,
  2
);

function TokenInput({
  id,
  masked,
  onChange,
  placeholder,
  value,
}: {
  id: string;
  masked: string | null;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <InputGroup className="w-full sm:w-80">
      <InputGroupInput
        autoComplete="off"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={masked ? `Saved (${masked})` : placeholder}
        type={visible ? "text" : "password"}
        value={value}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label={visible ? "Hide token" : "Show token"}
          onClick={() => setVisible((current) => !current)}
          size="icon-xs"
          type="button"
        >
          {visible ? (
            <ViewOffIcon className="size-4" />
          ) : (
            <ViewIcon className="size-4" />
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * Member IDs as removable badges. Enter, space, comma, paste or leaving the
 * field turns typed text into badges, so nothing sits half-entered.
 */
function MemberIdsInput({
  disabled,
  onChange,
  pairedIds,
  value,
}: {
  disabled: boolean;
  onChange: (ids: string[]) => void;
  pairedIds: string[];
  value: string[];
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pairedIdSet = new Set(pairedIds);

  function commit(raw: string) {
    const { ids, invalid } = parseSlackMemberIdInput(raw);
    if (ids.length > 0) {
      onChange([...new Set([...value, ...ids])]);
    }
    // Leave what was rejected in the field so it can be fixed, not retyped.
    setDraft(invalid.join(" "));
    setError(
      invalid.length > 0
        ? `${invalid.join(", ")}: not a member ID. Member IDs start with U or W, like U01ABCDEF.`
        : null
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="w-full space-y-1.5 sm:w-80">
      <label
        className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        htmlFor="slack-allowed-users"
      >
        {value.map((id) => (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 font-mono text-xs"
            key={id}
          >
            {id}
            {pairedIdSet.has(id) ? (
              <span className="font-sans text-muted-foreground">paired</span>
            ) : null}
            <button
              aria-label={`Remove ${id}`}
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              disabled={disabled}
              onClick={() => {
                onChange(value.filter((entry) => entry !== id));
                inputRef.current?.focus();
              }}
              type="button"
            >
              <Cancel01Icon aria-hidden className="size-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-[10rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={disabled}
          id="slack-allowed-users"
          onBlur={() => {
            if (draft.trim()) {
              commit(draft);
            }
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            event.preventDefault();
            commit(`${draft} ${event.clipboardData.getData("text")}`);
          }}
          placeholder={
            value.length > 0 ? "Add another" : "Paste a member ID, press Enter"
          }
          ref={inputRef}
          value={draft}
        />
      </label>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PairingGuide({ code }: { code: string }) {
  return (
    <div className="px-4 pb-3" id="slack-pairing-guide">
      <div className="overflow-hidden rounded-md border border-border">
        <PairingStepTile
          className="border-border border-b"
          description="In the Slack sidebar, open Nakama under Apps. Not listed? Search for Nakama at the top of Slack and open the app."
          step={1}
          title="Open Nakama in Slack"
        />
        <PairingStepTile
          className="border-border border-b"
          description={
            <>
              Go to its <span className="font-medium">Messages</span> tab and
              send <code className="font-mono">{code}</code> as a normal
              message. Do it in this DM only: a code posted in a channel or with
              an @mention is not accepted.
            </>
          }
          step={2}
          title="Send the code in the DM"
        />
        <PairingStepTile
          description="Nakama replies “Linked successfully” and the member appears under Allowed users. A code works once, so click New code for the next person."
          step={3}
          title="Wait for the reply"
        />
      </div>
    </div>
  );
}

function WorkspaceGuide() {
  return (
    <div className="px-4 pb-3" id="slack-workspace-guide">
      <div className="overflow-hidden rounded-md border border-border">
        <PairingStepTile
          className="border-border border-b"
          description="Members need no code. They open Nakama under Apps and send a message, or @mention Nakama in a channel it was added to."
          step={1}
          title="What members do"
        />
        <PairingStepTile
          description="Guests and people from other organizations in shared channels get no answer. Give them a pairing code or add their member ID below."
          step={2}
          title="Who still needs access"
        />
      </div>
    </div>
  );
}

function UsageGuide() {
  return (
    <details className="group px-4 py-3" id="slack-usage-guide">
      <summary className="cursor-pointer font-medium text-foreground text-sm">
        How members use Nakama in Slack
      </summary>
      <div className="mt-3 overflow-hidden rounded-md border border-border">
        <PairingStepTile
          className="border-border border-b"
          description="Open Nakama under Apps and type. Every message goes to the agent, and the DM keeps one conversation until !new."
          step={1}
          title="Direct message"
        />
        <PairingStepTile
          className="border-border border-b"
          description={
            <>
              Add the app to the channel once with{" "}
              <code className="font-mono">/invite @Nakama</code>, then @mention
              it. It answers in a thread; keep replying in that thread without
              mentioning it again.
            </>
          }
          step={2}
          title="In a channel"
        />
        <PairingStepTile
          description="!new starts over, !clear clears history, !stop stops a reply, !help lists the rest."
          step={3}
          title="Commands"
        />
      </div>
    </details>
  );
}

function statusBadge(state: {
  configured: boolean;
  connected: boolean;
  linked: boolean;
  running: boolean;
}) {
  if (!state.configured) {
    return "Not set up";
  }
  // A running worker can still have lost its Slack socket.
  if (state.running && !state.connected) {
    return "Disconnected";
  }
  if (state.linked && state.running) {
    return "Connected";
  }
  return state.linked ? "Paired" : "Awaiting link";
}

function SlackStatusHeader({
  configured,
  connected,
  embedded,
  linked,
  running,
}: {
  configured: boolean;
  connected: boolean;
  embedded: boolean;
  linked: boolean;
  running: boolean;
}) {
  if (embedded) {
    return null;
  }
  return (
    <IntegrationStatusHeader
      configured={configured}
      connected={linked && running && connected}
      statusBadge={statusBadge({ configured, connected, linked, running })}
      title="Slack"
    />
  );
}

function SlackSettingsFooter({
  appToken,
  botToken,
  configured,
  formError,
  hint,
  loadError,
  onSave,
  savePending,
}: {
  appToken: string;
  botToken: string;
  configured: boolean;
  formError: string | null;
  hint: string | null;
  loadError: ReturnType<typeof useSlackSettings>["error"];
  onSave: () => void;
  savePending: boolean;
}) {
  return (
    <IntegrationSettingsFooter
      canSave={configured || Boolean(botToken.trim() && appToken.trim())}
      formError={formError}
      loadError={loadError}
      onSave={onSave}
      savePending={savePending}
      statusLine={
        hint ?? formError ?? (loadError ? formatError(loadError) : null)
      }
      submitLabel="Save"
    />
  );
}

function ConfiguredSlackSettings({
  allowWorkspace,
  allowedUserIds,
  connected,
  copy,
  handleRegenerate,
  linked,
  onAllowedUserIdsChange,
  onAllowWorkspaceChange,
  pairedUserIds,
  pairingCode,
  pending,
  pm2Managed,
  regeneratePending,
  running,
}: {
  allowWorkspace: boolean;
  allowedUserIds: string[];
  connected: boolean;
  copy: (text: string, done: string) => Promise<void>;
  handleRegenerate: () => void;
  linked: boolean;
  onAllowedUserIdsChange: (ids: string[]) => void;
  onAllowWorkspaceChange: (checked: boolean) => void;
  pairedUserIds: string[];
  pairingCode: string | null;
  pending: boolean;
  pm2Managed: boolean;
  regeneratePending: boolean;
  running: boolean;
}) {
  return (
    <>
      <div>
        <SettingsRow
          description={
            pairingCode
              ? "Links one Slack member. Steps below."
              : "Click New code to link a Slack member."
          }
          label="Pairing code"
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            {pairingCode ? (
              <>
                <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
                  {pairingCode}
                </code>
                <Button
                  onClick={() => void copy(pairingCode, "Code copied.")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Copy
                </Button>
              </>
            ) : null}
            <Button
              disabled={pending}
              onClick={handleRegenerate}
              size="sm"
              type="button"
              variant={pairingCode || linked ? "outline" : "default"}
            >
              {regeneratePending ? <Spinner /> : "New code"}
            </Button>
          </div>
        </SettingsRow>
        {pairingCode ? <PairingGuide code={pairingCode} /> : null}
      </div>

      <div>
        <SettingsRow
          description="Full members chat without a pairing code."
          label="Everyone in the workspace"
        >
          <Switch
            aria-label="Everyone in the workspace"
            checked={allowWorkspace}
            disabled={pending}
            id="slack-allow-workspace"
            onCheckedChange={onAllowWorkspaceChange}
          />
        </SettingsRow>
        {allowWorkspace ? <WorkspaceGuide /> : null}
      </div>

      <SettingsRow
        description={
          allowWorkspace
            ? "Only needed for guests and people from other organizations. Press Enter after each member ID."
            : "Press Enter after each member ID. In Slack: open the profile, click ⋯, Copy member ID."
        }
        label="Allowed users"
      >
        <MemberIdsInput
          disabled={pending}
          onChange={onAllowedUserIdsChange}
          pairedIds={pairedUserIds}
          value={allowedUserIds}
        />
      </SettingsRow>

      <SettingsRow
        description={
          running
            ? connected
              ? "Running"
              : "Running, not connected to Slack"
            : "Stopped"
        }
        label="Bridge worker"
      >
        <WorkerActionBar
          pm2Managed={pm2Managed}
          running={running}
          workerName="slack"
        />
      </SettingsRow>

      <UsageGuide />
    </>
  );
}

export function SlackSettingsCard({
  embedded = false,
}: {
  /** Rendered inside the agent's channel page, which supplies its own heading. */
  embedded?: boolean;
}) {
  const {
    data: settings,
    isLoading,
    error: loadError,
    refetch,
  } = useSlackSettings();
  const { data: status } = useSystemStatusQuery();
  const saveMutation = useSaveSlackSettings();
  const regenerateMutation = useRegenerateSlackHandshake();
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  const [allowWorkspace, setAllowWorkspace] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // True while the form holds edits that are not saved yet. A ref, so marking
  // an edit never re-runs the sync below.
  const dirtyRef = useRef(false);
  // Paired IDs the form has already shown, so a refresh adds only new ones
  // and never restores a member the admin just removed.
  const seenPairedRef = useRef<string[]>([]);

  const applySaved = useCallback((saved: SlackSettingsResponse) => {
    seenPairedRef.current = saved.pairedUserIds;
    setAllowWorkspace(saved.allowWorkspace);
    // One access list: members who paired show up next to manual IDs.
    setAllowedUserIds([
      ...new Set([...saved.pairedUserIds, ...saved.allowedUserIds]),
    ]);
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    if (!dirtyRef.current) {
      applySaved(settings);
      return;
    }
    // Unsaved edits win; a refresh only adds members who paired since.
    const seenPaired = new Set(seenPairedRef.current);
    const newlyPaired = settings.pairedUserIds.filter(
      (id) => !seenPaired.has(id)
    );
    seenPairedRef.current = settings.pairedUserIds;
    if (newlyPaired.length > 0) {
      setAllowedUserIds((current) => [
        ...new Set([...current, ...newlyPaired]),
      ]);
    }
  }, [settings, applySaved]);

  // Pairing happens in Slack, so poll while a code is out and the tab is in
  // view, for at most ten minutes per code. A code never expires on its own.
  const pairingCodeValue = settings?.handshakeCode ?? null;
  useEffect(() => {
    if (!pairingCodeValue) {
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") {
        void refetch();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [pairingCodeValue, refetch]);

  if (isLoading) {
    return SETTINGS_CARD_LOADING_SKELETON;
  }

  const configured = settings?.configured === true;
  const linked =
    settings?.allowWorkspace === true ||
    (settings?.pairedUserIds.length ?? 0) > 0 ||
    (settings?.allowedUserIds.length ?? 0) > 0;
  const worker = status?.slackWorker;
  const running = worker?.running === true;
  const connected = worker?.connected === true;
  const pairingCode = settings?.handshakeCode ?? null;
  const pending = saveMutation.isPending || regenerateMutation.isPending;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setHint(done);
    } catch {
      setHint("Copy failed. Select the text and copy it manually.");
    }
  }

  function handleSave() {
    setFormError(null);
    setHint(null);
    // The bridge reads tokens when it starts, so a running one needs a restart.
    const needsRestart =
      Boolean(botToken.trim() || appToken.trim()) &&
      worker?.process?.status === "online";
    saveMutation.mutate(
      {
        allowedUserIds: allowedUserIds.join(","),
        allowWorkspace,
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
        ...(appToken.trim() ? { appToken: appToken.trim() } : {}),
      },
      {
        onError: (error) => setFormError(formatError(error)),
        onSuccess: (saved) => {
          dirtyRef.current = false;
          applySaved(saved);
          setBotToken("");
          setAppToken("");
          setHint(
            needsRestart
              ? "Saved. Restart the bridge worker so it uses the new tokens."
              : saved.handshakeCode
                ? "Saved. Send the pairing code to the bot in Slack."
                : "Saved."
          );
        },
      }
    );
  }

  function handleRegenerate() {
    setFormError(null);
    setHint(null);
    regenerateMutation.mutate(undefined, {
      onError: (error) => setFormError(formatError(error)),
    });
  }

  return (
    <div
      className={
        embedded
          ? "divide-y divide-border"
          : "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      }
      id="slack-settings-card"
    >
      <SlackStatusHeader
        configured={configured}
        connected={connected}
        embedded={embedded}
        linked={linked}
        running={running}
      />

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-foreground text-sm">Create the app</p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={SLACK_GUIDE_URL}
              id="link-slack-guide"
              rel="noreferrer"
              target="_blank"
            >
              Guide
            </a>
            <Button
              id="btn-copy-slack-manifest"
              onClick={() => void copy(SLACK_APP_MANIFEST, "Manifest copied.")}
              size="sm"
              type="button"
              variant="outline"
            >
              Copy manifest
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border border-border">
          <PairingStepTile
            className="border-border border-b"
            description={
              <>
                Open{" "}
                <a
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  href={SLACK_NEW_APP_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Slack apps
                </a>
                , choose From a manifest, pick your workspace, and paste the
                manifest.
              </>
            }
            step={1}
            title="New app from manifest"
          />
          <PairingStepTile
            className="border-border border-b"
            description="Install App → Install to Workspace, then copy the Bot User OAuth Token (xoxb-)."
            step={2}
            title="Bot token"
          />
          <PairingStepTile
            description="Basic Information → App-Level Tokens → Generate with the connections:write scope (xapp-)."
            step={3}
            title="App token"
          />
        </div>
      </div>

      <SettingsRow label="Bot token">
        <TokenInput
          id="slack-bot-token"
          masked={settings?.botTokenMasked ?? null}
          onChange={setBotToken}
          placeholder="xoxb-…"
          value={botToken}
        />
      </SettingsRow>

      <SettingsRow label="App token">
        <TokenInput
          id="slack-app-token"
          masked={settings?.appTokenMasked ?? null}
          onChange={setAppToken}
          placeholder="xapp-…"
          value={appToken}
        />
      </SettingsRow>

      {configured ? (
        <ConfiguredSlackSettings
          allowedUserIds={allowedUserIds}
          allowWorkspace={allowWorkspace}
          connected={connected}
          copy={copy}
          handleRegenerate={handleRegenerate}
          linked={linked}
          onAllowedUserIdsChange={(ids) => {
            setAllowedUserIds(ids);
            dirtyRef.current = true;
          }}
          onAllowWorkspaceChange={(checked) => {
            setAllowWorkspace(checked);
            dirtyRef.current = true;
          }}
          pairedUserIds={settings?.pairedUserIds ?? []}
          pairingCode={pairingCode}
          pending={pending}
          pm2Managed={worker?.process?.managed ?? false}
          regeneratePending={regenerateMutation.isPending}
          running={running}
        />
      ) : null}

      <SlackSettingsFooter
        appToken={appToken}
        botToken={botToken}
        configured={configured}
        formError={formError}
        hint={hint}
        loadError={loadError}
        onSave={handleSave}
        savePending={saveMutation.isPending}
      />
    </div>
  );
}
