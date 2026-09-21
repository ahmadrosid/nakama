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
import {
  ChannelAccessSettings,
  ChannelConnectionStep,
  ChannelSettings,
  ChannelSetupChecklist,
  IntegrationSettingsFooter,
  PairingStepTile,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { TelegramQrSetup } from "@/components/telegram-qr-setup";
import { WorkerActionBar } from "@/components/WorkerActionBar";

function pairingCodeDescription(
  pairingCode: string | null,
  isPaired: boolean
): string {
  if (pairingCode) {
    if (isPaired) {
      return "Message this code to your bot to link another account.";
    }

    return "Message this code to your bot to finish linking.";
  }

  if (isPaired) {
    return "Linked. Generate a new code to add another account.";
  }

  return "Generate a code, then message it to your bot once.";
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
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        {regeneratePending ? (
          <Spinner />
        ) : (
          <>
            <RefreshIcon aria-hidden="true" className="size-3.5" />
            New code
          </>
        )}
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
      <details className="mb-3 text-sm">
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

function TelegramPairingGuide() {
  return (
    <div className="mx-4 space-y-3">
      <p className="font-medium text-foreground text-xs">Link in Telegram</p>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <PairingStepTile
            className="border-border border-b sm:border-r sm:border-b-0"
            description="Start a private chat with your bot."
            step={1}
            title="Open the bot"
          />
          <PairingStepTile
            description="Paste the pairing code and send it."
            step={2}
            title="Send the code"
          />
        </div>
      </div>

      <details className="group mt-4 mb-3">
        <summary className="cursor-pointer text-muted-foreground text-xs transition-colors hover:text-foreground">
          Using the bot in a group?
        </summary>
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <PairingStepTile
            className="border-border border-b"
            description="Link your account in a private chat before using groups."
            step={1}
            title="Pair privately first"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <PairingStepTile
              className="border-border border-b sm:border-r sm:border-b-0"
              description={
                <>
                  Turn it off in{" "}
                  <a
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    href="https://t.me/BotFather"
                    rel="noreferrer"
                    target="_blank"
                  >
                    @BotFather
                  </a>{" "}
                  so @mentions work.
                </>
              }
              step={2}
              title="Disable Group Privacy"
            />
            <PairingStepTile
              className="border-border border-b"
              description="Remove and re-add the bot after changing Group Privacy."
              step={3}
              title="Re-add the bot"
            />
          </div>
          <PairingStepTile
            description="@mention the bot, reply to it, or use a slash command."
            step={4}
            title="Trigger in the group"
          />
        </div>
      </details>
    </div>
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
  worker: { process?: { managed?: boolean } } | null | undefined;
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

  const step = configured ? (running ? (hasLinkedUsers ? 3 : 2) : 1) : 0;
  const workerActions = (
    <WorkerActionBar
      compact
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
    <div className="space-y-3">
      <SettingsRow
        description={pairingCodeDescription(pairingCode, isPaired)}
        label="Link with a code"
        layout="stacked"
      >
        <TelegramPairingCodeControls
          isPaired={isPaired}
          onCopyHandshakeCode={onCopyHandshakeCode}
          onRegenerateHandshake={onRegenerateHandshake}
          pairingCode={pairingCode}
          regeneratePending={regeneratePending}
          savePending={savePending}
        />
      </SettingsRow>
      <details className="px-4 pb-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Need help?
        </summary>
        <div className="pt-3">
          <TelegramPairingGuide />
        </div>
      </details>
    </div>
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
        {tokenEditor}
        {pairing}
      </ChannelSettings>
      {footer}
    </div>
  );
}
