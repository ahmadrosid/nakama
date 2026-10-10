import { Button } from "@nakama/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { Spinner } from "@nakama/ui/spinner";
import {
  Copy01Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from "hugeicons-react";
import { type ReactNode, useState } from "react";
import {
  ChannelAccessSettings,
  ChannelConnectionStep,
  ChannelSettings,
  ChannelSetupChecklist,
  IntegrationSettingsFooter,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { TelegramQrSetup } from "@/components/telegram-qr-setup";
import { WorkerActionBar } from "@/components/WorkerActionBar";

function pairingCodeDescription(
  pairingCode: string | null,
  isPaired: boolean
): string {
  if (pairingCode) {
    return "Send this code to your bot in a private chat. It expires in 10 minutes.";
  }

  if (isPaired) {
    return "Your Telegram account can message the bot.";
  }

  return "Generate a code, then message it to your bot once.";
}

function pairingRowLabel(pairingCode: string | null, isPaired: boolean) {
  if (!isPaired) {
    return "Link with a code";
  }

  return pairingCode ? "Add account" : "Linked account";
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
              New code
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
        {regeneratePending ? <Spinner /> : "Add account"}
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
          Generating…
        </>
      ) : (
        "Generate pairing code"
      )}
    </Button>
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
    <SettingsRow className={paneItemClass} label="Bot token" layout="stacked">
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
          aria-label="Bot token"
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
              { content: "Copy the token it sends you.", id: "copy-token" },
            ]}
            title="Bot token"
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
  statusBadge: string;
};

export function TelegramSettingsCardContent({
  view,
  statusBadge,
  settings,
  botToken,
  onBotTokenChange,
  onBotTokenPaste,
  onToggleShowBotToken,
  pairingCode,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  allowedUserSummary,
  onManageAllowedUsers,
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
  statusBadge: string;
  pairingCode: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  allowedUserSummary: string;
  onManageAllowedUsers: () => void;
  profileId: string;
  worker:
    | { process?: { error?: string; managed?: boolean } }
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

  const step = configured ? (running ? (hasLinkedUsers ? 3 : 2) : 1) : 0;

  const workerActions = (
    <WorkerActionBar
      compact
      pm2Error={worker?.process?.error}
      pm2Managed={worker?.process?.managed ?? false}
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

  const pairing = (
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
            Using a group? Link here first, turn off Group Privacy in{" "}
            <BotFatherLink />, then remove and re-add the bot.
          </p>
        ) : null}
      </SettingsRow>
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

  const checklist = (
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
          managed={worker?.process?.managed === true}
          platform="telegram"
          running={running}
          starting={savePending}
        >
          {workerActions}
          {tokenEditor}
        </ChannelConnectionStep>
      ) : null}
      {step === 2 ? pairing : null}
      {step === 0 ? null : footer}
    </ChannelSetupChecklist>
  );

  if (step < 3) {
    return checklist;
  }

  return (
    <div className="space-y-4">
      {checklist}
      <ChannelAccessSettings
        actions={workerActions}
        configured={configured}
        onEdit={onManageAllowedUsers}
        pending={savePending}
        statusBadge={statusBadge}
        summary={allowedUserSummary}
      />
      <ChannelSettings>
        <SettingsRow label="Bot token">
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
              {replacingToken ? "Cancel" : "Replace"}
            </Button>
          </div>
        </SettingsRow>
        {replacingToken ? tokenEditor : null}
        {pairing}
      </ChannelSettings>
      {footer}
    </div>
  );
}
