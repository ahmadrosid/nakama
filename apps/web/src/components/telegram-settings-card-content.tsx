import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  Copy01Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from "hugeicons-react";
import { type ReactNode, useState } from "react";
import {
  ChannelConnectionStep,
  ChannelSettings,
  ChannelSetupChecklist,
  IntegrationSettingsFooter,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { TelegramQrSetup } from "@/components/telegram-qr-setup";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import {
  useResolveTelegramAccessRequest,
  useTelegramAccessRequests,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

function pairingCodeDescription(
  pairingCode: string | null,
  isPaired: boolean
): string {
  if (pairingCode) {
    return "Send this code to your bot in Telegram. It works for 10 minutes.";
  }

  if (isPaired) {
    return "Make a code, then send it to your bot in Telegram.";
  }

  return "Make a code, then send it to your bot in Telegram.";
}

function pairingRowLabel(pairingCode: string | null, isPaired: boolean) {
  return isPaired || pairingCode
    ? "Add someone with a code"
    : "Link your Telegram";
}

function TelegramPairingCodeControls({
  isPaired,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  pairingCode,
  regeneratePending,
  savePending,
}: {
  isPaired: boolean;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  pairingCode: string | null;
  regeneratePending: boolean;
  savePending: boolean;
}) {
  if (pairingCode) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
          {pairingCode}
        </code>
        <Button
          onClick={onCopyHandshakeCode}
          size="sm"
          type="button"
          variant="outline"
        >
          <Copy01Icon className="size-4" />
          Copy
        </Button>
        <Button
          disabled={regeneratePending || savePending}
          onClick={onRegenerateHandshake}
          size="sm"
          type="button"
          variant="outline"
        >
          {regeneratePending ? (
            <Spinner />
          ) : (
            <>
              <RefreshIcon aria-hidden="true" className="size-3.5" />
              Make a new code
            </>
          )}
        </Button>
      </div>
    );
  }

  if (isPaired) {
    return (
      <Button
        disabled={regeneratePending || savePending}
        onClick={onRegenerateHandshake}
        size="sm"
        type="button"
        variant="outline"
      >
        {regeneratePending ? <Spinner /> : "Make a code"}
      </Button>
    );
  }

  return (
    <Button
      disabled={regeneratePending || savePending}
      onClick={onRegenerateHandshake}
      size="sm"
      type="button"
    >
      {regeneratePending ? (
        <>
          <Spinner className="size-3" />
          Making code…
        </>
      ) : (
        "Make a code"
      )}
    </Button>
  );
}

function formatUptime(seconds: number | null | undefined): string {
  if (!seconds) {
    return "Just started";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `Running for ${Math.max(minutes, 1)} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 48) {
    return `Running for ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `Running for ${Math.floor(hours / 24)} days`;
}

function TelegramInviteLink() {
  const { data } = useTelegramAccessRequests();
  const [copied, setCopied] = useState(false);
  const link = data?.botUsername ? `https://t.me/${data.botUsername}` : null;

  if (!link) {
    return null;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <h3 className="font-medium text-sm">Invite someone</h3>
      <InputGroup>
        <InputGroupInput
          aria-label="Bot link"
          className="font-mono text-sm"
          readOnly
          value={link}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            onClick={() => void copyLink()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Copy01Icon aria-hidden />
            {copied ? "Copied" : "Copy link"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function TelegramAccessRequests() {
  const { data } = useTelegramAccessRequests();
  const resolve = useResolveTelegramAccessRequest();
  const requests = data?.requests ?? [];

  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="divide-y divide-border">
      <h3 className="px-4 py-3 font-medium text-sm">Asking for access</h3>
      {requests.map((request) => (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3"
          key={request.userId}
        >
          <div className="min-w-0">
            <div className="truncate text-sm">
              {request.username ? `@${request.username}` : request.userId}
            </div>
            {request.username ? (
              <div className="text-muted-foreground text-xs">
                {request.userId}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ decision: "deny", userId: request.userId })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Decline
            </Button>
            <Button
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({
                  decision: "approve",
                  userId: request.userId,
                })
              }
              size="sm"
              type="button"
            >
              Allow
            </Button>
          </div>
        </div>
      ))}
      {resolve.error ? (
        <p className="px-4 py-3 text-destructive text-xs" role="alert">
          {formatError(resolve.error)}
        </p>
      ) : null}
    </div>
  );
}

function TelegramBotTokenRow({
  botToken,
  configured,
  onBotTokenChange,
  onBotTokenPaste,
  onToggleShowBotToken,
  paneItemClass,
  savePending,
  settings,
  showBotToken,
}: {
  botToken: string;
  configured: boolean;
  onBotTokenChange: (value: string) => void;
  onBotTokenPaste: (value: string) => void;
  onToggleShowBotToken: () => void;
  paneItemClass: string | undefined;
  savePending: boolean;
  settings: { botTokenMasked?: string | null } | null | undefined;
  showBotToken: boolean;
}) {
  return (
    <SettingsRow className={paneItemClass} label="Bot key" layout="stacked">
      <details className={configured ? "hidden" : "mb-3 text-sm"}>
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline-ring">
          How to get your bot token
        </summary>
        <ol className="list-decimal space-y-2 pt-3 pl-5 text-muted-foreground">
          <li>
            <a
              className="font-medium text-primary hover:underline"
              href="https://t.me/BotFather"
              rel="noreferrer"
              target="_blank"
            >
              Open @BotFather ↗
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            in Telegram.
          </li>
          <li>
            Send <strong>/newbot</strong> and follow the instructions to choose
            a name and username.
          </li>
          <li>Copy the token BotFather sends you, then paste it below.</li>
        </ol>
      </details>
      <InputGroup className="w-full">
        <InputGroupInput
          aria-label="Bot key"
          autoComplete="off"
          disabled={savePending}
          id="telegram-bot-token"
          onChange={(event) => onBotTokenChange(event.target.value)}
          onPaste={(event) => {
            if (configured) {
              return;
            }

            const token = event.clipboardData.getData("text").trim();

            if (token) {
              event.preventDefault();
              onBotTokenPaste(token);
            }
          }}
          placeholder={
            configured && settings?.botTokenMasked
              ? `Saved (${settings.botTokenMasked})`
              : "Paste token from @BotFather"
          }
          type={showBotToken ? "text" : "password"}
          value={botToken}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={showBotToken ? "Hide token" : "Show token"}
            onClick={onToggleShowBotToken}
            size="icon-xs"
            type="button"
          >
            {showBotToken ? (
              <ViewOffIcon className="size-4" />
            ) : (
              <ViewIcon className="size-4" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </SettingsRow>
  );
}

function BotFatherLink() {
  return (
    <a
      className="font-medium text-primary underline-offset-2 hover:underline"
      href="https://t.me/BotFather"
      rel="noreferrer"
      target="_blank"
    >
      @BotFather
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function SetupHelpList({
  items,
  title,
}: {
  items: { content: ReactNode; id: string }[];
  title: string;
}) {
  return (
    <div>
      <p className="mb-2 font-medium text-foreground text-xs">{title}</p>
      <ol className="list-decimal space-y-1.5 pl-4.5">
        {items.map((item) => (
          <li key={item.id}>{item.content}</li>
        ))}
      </ol>
    </div>
  );
}

function TelegramSetupHelp() {
  return (
    <details className="px-4 py-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
        Setup help
      </summary>
      <div className="grid gap-6 pt-3 text-muted-foreground text-xs leading-relaxed sm:grid-cols-2">
        <div className="space-y-4">
          <SetupHelpList
            items={[
              {
                content: (
                  <>
                    Open <BotFatherLink /> in Telegram.
                  </>
                ),
                id: "open-botfather",
              },
              { content: "Send /newbot and pick a name.", id: "newbot" },
              { content: "Copy the key it sends you.", id: "copy-token" },
            ]}
            title="Bot key"
          />
          <SetupHelpList
            items={[
              {
                content: "Open a private chat with your bot.",
                id: "open-chat",
              },
              { content: "Send the pairing code.", id: "send-code" },
            ]}
            title="Link an account"
          />
        </div>
        <SetupHelpList
          items={[
            {
              content: "Link your account in a private chat first.",
              id: "link-first",
            },
            {
              content: (
                <>
                  In <BotFatherLink />, turn off Group Privacy.
                </>
              ),
              id: "group-privacy",
            },
            {
              content: "Remove the bot from the group, then add it again.",
              id: "re-add-bot",
            },
            {
              content: "@mention the bot, reply to it, or use a slash command.",
              id: "mention-bot",
            },
          ]}
          title="Use in a group"
        />
      </div>
    </details>
  );
}

function TelegramConnectionStatus({
  running,
  uptimeSeconds,
  children,
}: {
  running: boolean;
  uptimeSeconds: number | null | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4",
        running ? "border-border bg-card" : "border-amber-500/30 bg-amber-500/5"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full",
            running ? "bg-emerald-600" : "bg-amber-500"
          )}
        />
        <div>
          <p className="font-semibold text-sm">
            {running ? "Connected" : "Offline"}
          </p>
          <p className="text-muted-foreground text-xs">
            {running
              ? formatUptime(uptimeSeconds)
              : "Messages are not being answered"}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function TelegramSetupSteps({
  step,
  profileId,
  running,
  managed,
  savePending,
  workerActions,
  tokenEditor,
  footer,
  pairing,
}: {
  step: number;
  profileId: string;
  running: boolean;
  managed: boolean;
  savePending: boolean;
  workerActions: ReactNode;
  tokenEditor: ReactNode;
  footer: ReactNode;
  pairing: ReactNode;
}) {
  return (
    <ChannelSetupChecklist
      label="Telegram setup progress"
      step={step}
      steps={["Add bot", "Start connection", "Link account"]}
    >
      {step === 0 ? (
        <div className="grid gap-4 px-4 pb-3 md:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-primary/20 bg-primary/5">
            <TelegramQrSetup profileId={profileId} running={running} />
          </div>
          <div className="flex min-w-0 flex-col justify-between rounded-xl border border-border">
            {tokenEditor}
            {footer}
          </div>
        </div>
      ) : null}
      {step === 1 ? (
        <ChannelConnectionStep
          managed={managed}
          platform="telegram"
          running={running}
          starting={savePending}
        >
          {workerActions}
          {tokenEditor}
        </ChannelConnectionStep>
      ) : null}
      {step === 2 ? (
        <>
          <TelegramAccessRequests />
          {pairing}
        </>
      ) : null}
      {step === 0 ? null : footer}
    </ChannelSetupChecklist>
  );
}

export type TelegramSettingsCardView = {
  embedded: boolean;
  configured: boolean;
  hasLinkedUsers: boolean;
  running: boolean;
  showBotToken: boolean;
  savePending: boolean;
  isPaired: boolean;
  regeneratePending: boolean;
  canSave: boolean;
};

export function TelegramSettingsCardContent({
  view,
  settings,
  botToken,
  onBotTokenChange,
  onBotTokenPaste,
  onToggleShowBotToken,
  pairingCode,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  allowedUsersPanel,
  profileId,
  worker,
  statusLine,
  formError,
  loadError,
  submitLabel,
  onSave,
}: {
  settings: { botTokenMasked?: string | null } | null | undefined;
  botToken: string;
  onBotTokenChange: (value: string) => void;
  onBotTokenPaste: (value: string) => void;
  onToggleShowBotToken: () => void;
  view: TelegramSettingsCardView;
  pairingCode: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  allowedUsersPanel: ReactNode;
  profileId: string;
  worker:
    | {
        process?: {
          error?: string;
          managed?: boolean;
          uptimeSeconds?: number | null;
        };
      }
    | null
    | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  submitLabel: string;
  onSave: () => void;
}) {
  const {
    canSave,
    configured,
    hasLinkedUsers,
    isPaired,
    regeneratePending,
    running,
    savePending,
    showBotToken,
  } = view;

  const paneItemClass = "px-4 py-3";
  const [replacingToken, setReplacingToken] = useState(false);
  const pairingLabel = pairingRowLabel(pairingCode, isPaired);

  let step = 0;

  if (configured) {
    step = 1;
  }

  if (configured && running) {
    step = hasLinkedUsers ? 3 : 2;
  }

  const workerActions = (
    <WorkerActionBar
      compact
      pm2Error={worker?.process?.error}
      pm2Managed={worker?.process?.managed === true}
      running={running}
      workerName="telegram"
    />
  );

  const tokenEditor = (
    <TelegramBotTokenRow
      botToken={botToken}
      configured={configured}
      onBotTokenChange={onBotTokenChange}
      onBotTokenPaste={onBotTokenPaste}
      onToggleShowBotToken={onToggleShowBotToken}
      paneItemClass={paneItemClass}
      savePending={savePending}
      settings={settings}
      showBotToken={showBotToken}
    />
  );

  const pairingRow = (
    <>
      <SettingsRow
        description={pairingCodeDescription(pairingCode, isPaired)}
        label={pairingLabel}
        layout={pairingCode || !isPaired ? "stacked" : "inline"}
      >
        <TelegramPairingCodeControls
          isPaired={isPaired}
          onCopyHandshakeCode={onCopyHandshakeCode}
          onRegenerateHandshake={onRegenerateHandshake}
          pairingCode={pairingCode}
          regeneratePending={regeneratePending}
          savePending={savePending}
        />
        {pairingCode ? (
          <p className="mt-3 text-muted-foreground text-xs">
            Want to use the bot in a group? Link here first. Then turn off Group
            Privacy in <BotFatherLink />, and add the bot to the group again.
          </p>
        ) : null}
      </SettingsRow>
    </>
  );

  const pairing = (
    <>
      {pairingRow}
      <TelegramSetupHelp />
    </>
  );

  const footer = (
    <IntegrationSettingsFooter
      canSave={canSave}
      className={paneItemClass}
      formError={formError}
      loadError={loadError}
      onSave={onSave}
      savePending={savePending}
      showSave={canSave || savePending || !configured}
      statusLine={statusLine}
      submitLabel={configured ? submitLabel : "Continue"}
    />
  );

  if (step < 3) {
    return (
      <TelegramSetupSteps
        footer={footer}
        managed={worker?.process?.managed === true}
        pairing={pairing}
        profileId={profileId}
        running={running}
        savePending={savePending}
        step={step}
        tokenEditor={tokenEditor}
        workerActions={workerActions}
      />
    );
  }

  return (
    <div className="space-y-4">
      <TelegramConnectionStatus
        running={running}
        uptimeSeconds={worker?.process?.uptimeSeconds}
      >
        {workerActions}
      </TelegramConnectionStatus>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <TelegramInviteLink />
          <TelegramAccessRequests />
          {allowedUsersPanel}
        </CardContent>
      </Card>
      <ChannelSettings>
        <SettingsRow label="Bot key">
          <div className="flex items-center gap-3">
            <code className="text-muted-foreground text-xs">
              {settings?.botTokenMasked ?? "Saved"}
            </code>
            <Button
              onClick={() => {
                if (replacingToken) {
                  onBotTokenChange("");
                }

                setReplacingToken(!replacingToken);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {replacingToken ? "Cancel" : "Change"}
            </Button>
          </div>
        </SettingsRow>
        {replacingToken ? tokenEditor : null}
        {pairingRow}
      </ChannelSettings>
      {footer}
    </div>
  );
}
