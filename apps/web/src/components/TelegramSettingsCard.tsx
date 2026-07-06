import { useEffect, useState, type ReactNode } from "react";
import type { UpdateTelegramSettingsRequest } from "@nakama/core/contract";
import { CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import {
  TelegramAllowedUsersDialog,
  type AllowedTelegramUser,
} from "@/components/TelegramAllowedUsersDialog";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import {
  useRegenerateTelegramHandshake,
  useSaveTelegramSettings,
  useTelegramSettings,
} from "@/hooks/use-telegram-settings";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

interface TelegramSettingsCardProps {
  embedded?: boolean;
  submitLabel?: string;
  onSaveSuccess?: () => void;
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function TelegramSettingsCard({
  embedded = false,
  submitLabel = "Save",
  onSaveSuccess,
}: TelegramSettingsCardProps) {
  const { data: settings, isLoading, error: loadError } = useTelegramSettings();
  const { data: status } = useSystemStatusQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const saveMutation = useSaveTelegramSettings();
  const regenerateMutation = useRegenerateTelegramHandshake();

  const [botToken, setBotToken] = useState("");
  const [showBotToken, setShowBotToken] = useState(false);
  const [profileId, setProfileId] = useState("default");
  const [allowedUsers, setAllowedUsers] = useState<AllowedTelegramUser[]>([]);
  const [allowedUsersOpen, setAllowedUsersOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProfileId(settings.profileId);
    setBotToken("");
    setAllowedUsers((current) => {
      const existing = new Map(current.map((user) => [user.id, user]));
      return settings.allowedUserIds.map((id) => {
        const stringId = String(id);
        return existing.get(stringId) ?? { id: stringId };
      });
    });
  }, [settings]);

  const configured = settings?.configured === true;
  const isPaired = (settings?.pairedUserIds.length ?? 0) > 0;
  const hasAllowedUsers = (settings?.allowedUserIds.length ?? 0) > 0;
  const hasLinkedUsers = isPaired || hasAllowedUsers;
  const pairingCode = settings?.handshakeCode ?? null;
  const worker = status?.telegramWorker;
  const running = worker?.running === true;
  const canSave = configured || botToken.trim().length > 0;
  const allowedUserSummary =
    allowedUsers.length === 0
      ? "No manual users"
      : `${allowedUsers.length} user${allowedUsers.length === 1 ? "" : "s"}`;

  const statusLine =
    hint ?? (formError ? formError : null) ?? (loadError ? formatError(loadError) : null);

  const headerSubtitle = !configured
    ? "Step 1: paste a bot token from @BotFather"
    : hasLinkedUsers && running
      ? "Your Telegram is connected to Nakama"
      : hasLinkedUsers
        ? "Linked. Start the bridge to receive messages"
        : pairingCode
          ? "Step 2: send your pairing code to the bot in Telegram"
          : "Step 2: generate a pairing code and send it to your bot";

  const statusBadge = !configured
    ? "Not set up"
    : hasLinkedUsers && running
      ? "Connected"
      : hasLinkedUsers
        ? "Paired"
        : "Awaiting link";

  async function copyHandshakeCode() {
    if (!pairingCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingCode);
      setHint("Code copied — paste it in Telegram.");
    } catch {
      setHint("Copy the code manually.");
    }
  }

  function handleSave(afterSuccess?: () => void) {
    setFormError(null);
    setHint(null);

    const request: UpdateTelegramSettingsRequest = {
      allowedUserIds: allowedUsers.map((user) => user.id).join(","),
      profileId: profileId.trim() || "default",
    };

    if (botToken.trim()) {
      request.botToken = botToken.trim();
    }

    saveMutation.mutate(request, {
      onSuccess: (saved) => {
        setBotToken("");
        const savedHasLinkedUsers =
          saved.pairedUserIds.length > 0 || saved.allowedUserIds.length > 0;

        if (saved.handshakeCode && !savedHasLinkedUsers) {
          setHint("Saved. Send the pairing code to your bot.");
        } else if (savedHasLinkedUsers) {
          setHint("Saved.");
        } else {
          setHint("Saved. Get a pairing code if you still need to link.");
        }
        afterSuccess?.();
        onSaveSuccess?.();
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  }

  function handleRegenerateHandshake() {
    setFormError(null);
    setHint(null);

    regenerateMutation.mutate(undefined, {
      onSuccess: () => {
        setHint("New code ready — send it to your bot in Telegram.");
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  }

  if (isLoading) {
    const skeleton = (
      <div className="h-16 animate-pulse rounded-lg bg-muted px-4" aria-hidden="true" />
    );

    if (embedded) {
      return skeleton;
    }

    return (
      <Card className="w-full shadow-none">
        <CardContent className="py-3">{skeleton}</CardContent>
      </Card>
    );
  }

  const content = (
    <div className="divide-y divide-border">
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">Telegram</p>
            <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              hasLinkedUsers && running
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : configured
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100"
                  : "border-border bg-muted text-muted-foreground",
            )}
          >
            {statusBadge}
          </span>
        </div>
      ) : null}

      <SettingsRow label="Bot token" description="From @BotFather">
        <InputGroup className="w-full min-w-[12rem] sm:w-[16rem]">
          <InputGroupInput
            id="telegram-bot-token"
            type={showBotToken ? "text" : "password"}
            autoComplete="off"
            placeholder={
              configured && settings?.botTokenMasked
                ? `Saved (${settings.botTokenMasked})`
                : "Paste token"
            }
            value={botToken}
            disabled={saveMutation.isPending}
            onChange={(event) => {
              setBotToken(event.target.value);
              setHint(null);
              if (formError) {
                setFormError(null);
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              aria-label={showBotToken ? "Hide token" : "Show token"}
              onClick={() => setShowBotToken((current) => !current)}
            >
              {showBotToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </SettingsRow>

      {configured ? (
        <div
          className={cn(
            "divide-y divide-border",
            !isPaired && "bg-muted/20",
          )}
        >
          <SettingsRow
            label="Pairing code"
            description={
              isPaired
                ? "Telegram is linked. Generate a new code to link another account."
                : pairingCode
                  ? "Send this code to your bot in Telegram to finish linking."
                  : "Generate a code, then message it to your bot once."
            }
          >
            {isPaired ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={regenerateMutation.isPending || saveMutation.isPending}
                onClick={handleRegenerateHandshake}
              >
                {regenerateMutation.isPending ? (
                  <Spinner />
                ) : (
                  <>
                    <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                    New code
                  </>
                )}
              </Button>
            ) : pairingCode ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
                  {pairingCode}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyHandshakeCode()}
                >
                  <CopyIcon className="size-4" />
                  Copy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={regenerateMutation.isPending || saveMutation.isPending}
                  onClick={handleRegenerateHandshake}
                >
                  {regenerateMutation.isPending ? (
                    <Spinner />
                  ) : (
                    <>
                      <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                      New code
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={regenerateMutation.isPending || saveMutation.isPending}
                onClick={handleRegenerateHandshake}
              >
                {regenerateMutation.isPending ? (
                  <>
                    <Spinner className="mr-2" />
                    Generating…
                  </>
                ) : (
                  "Generate pairing code"
                )}
              </Button>
            )}
          </SettingsRow>

          {!isPaired && pairingCode ? (
            <ol className="list-decimal space-y-1 px-4 py-3 pl-8 text-xs text-muted-foreground">
              <li>Open your bot in the Telegram app</li>
              <li>Paste or type the pairing code as a message</li>
              <li>For groups: link in a private chat first.</li>
              <li>In @BotFather, disable Group Privacy for the bot if you want @mentions to work reliably.</li>
              <li>If you changed Group Privacy, remove the bot from the group and add it back.</li>
              <li>Add the bot to the group, then trigger it with an @mention, a reply, or a slash command.</li>
            </ol>
          ) : null}
        </div>
      ) : null}

      {configured ? (
        <SettingsRow
          label="Allowed users"
          description="Telegram user IDs that can use this bot"
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">{allowedUserSummary}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saveMutation.isPending}
              onClick={() => setAllowedUsersOpen(true)}
            >
              Manage
            </Button>
          </div>
        </SettingsRow>
      ) : null}

      {configured ? (
        <SettingsRow label="Reply as" description="Which agent answers on Telegram">
          <Select
            value={profileId}
            disabled={saveMutation.isPending || profiles.length === 0}
            onValueChange={(value) => {
              if (value) {
                setProfileId(String(value));
                setHint(null);
              }
            }}
          >
            <SelectTrigger id="telegram-profile" className="w-[11rem] sm:w-[13rem]">
              <SelectValue placeholder="Profile">
                {profiles.find((profile) => profile.id === profileId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  <span className="flex items-center gap-2">
                    <ProfileAvatar profile={profile} size="sm" />
                    <span>{profile.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      ) : null}

      {configured ? (
        <SettingsRow
          label="Bridge worker"
          description={running ? "Running" : "Stopped"}
        >
          <WorkerActionBar
            workerName="telegram"
            running={running}
            pm2Managed={worker?.process?.managed ?? false}
          />
        </SettingsRow>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {statusLine ? (
          <p
            className={cn(
              "min-w-0 text-xs",
              formError || loadError ? "text-destructive" : "text-emerald-200",
            )}
            role={formError || loadError ? "alert" : "status"}
          >
            {statusLine}
          </p>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending || !canSave}
          onClick={() => handleSave()}
        >
          {saveMutation.isPending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </div>
  );

  const allowedUsersDialog = (
    <TelegramAllowedUsersDialog
      open={allowedUsersOpen}
      onOpenChange={setAllowedUsersOpen}
      allowedUsers={allowedUsers}
      onAllowedUsersChange={setAllowedUsers}
      profileId={profileId}
      onSaved={() => {
        setHint("Allowed users saved.");
        setFormError(null);
      }}
      onError={setFormError}
    />
  );

  if (embedded) {
    return (
      <>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
          {content}
        </div>
        {allowedUsersDialog}
      </>
    );
  }

  return (
    <>
      <Card className="w-full shadow-none">
        <CardContent className="p-0">{content}</CardContent>
      </Card>
      {allowedUsersDialog}
    </>
  );
}
