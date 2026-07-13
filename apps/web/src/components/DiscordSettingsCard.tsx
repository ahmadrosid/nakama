import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UpdateDiscordSettingsRequest } from "@nakama/core/contract";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import {
  DiscordAllowedUsersDialog,
  type AllowedDiscordUser,
} from "@/components/DiscordAllowedUsersDialog";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { Button, buttonVariants } from "@/components/ui/button";
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
  useRegenerateDiscordHandshake,
  useSaveDiscordSettings,
  useDiscordSettings,
} from "@/hooks/use-discord-settings";
import { formatError } from "@/lib/client";
import { DISCORD_DEVELOPER_PORTAL_URL, DISCORD_SETUP_GUIDE_URL } from "@/lib/integration-docs";
import { cn } from "@/lib/utils";

interface DiscordSettingsCardProps {
  embedded?: boolean;
  submitLabel?: string;
  onSaveSuccess?: () => void;
}

function PairingStepTile({
  step,
  title,
  description,
  className,
}: {
  step: number;
  title: string;
  description: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("p-3", className)}>
      <div className="flex items-start gap-2">
        <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {step}.
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function DiscordPairingGuide({ inviteUrl }: { inviteUrl: string | null }) {
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Link in Discord</p>
        {inviteUrl ? (
          <a
            href={inviteUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
          >
            Invite bot to server
          </a>
        ) : null}
      </div>
      <div className="overflow-hidden border border-border">
        <PairingStepTile
          step={1}
          title="Invite the bot"
          className="border-b border-border"
          description={
            inviteUrl ? (
              <>
                Click{" "}
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Invite bot to server
                </a>{" "}
                above, pick a server, and approve the permissions.
              </>
            ) : (
              <>
                Create an invite link in the{" "}
                <a
                  href={DISCORD_DEVELOPER_PORTAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Developer Portal
                </a>{" "}
                and add the bot to a server. See the{" "}
                <a
                  href={DISCORD_SETUP_GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  setup guide
                </a>
                .
              </>
            )
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <PairingStepTile
            step={2}
            title="Open a DM"
            className="border-b border-border sm:border-b-0 sm:border-r"
            description={
              <>
                In that server, right-click the bot in the member list and choose{" "}
                <span className="font-medium text-foreground">Message</span>.
              </>
            }
          />
          <PairingStepTile
            step={3}
            title="Send the code"
            description="Paste the pairing code from above into that DM and send it."
          />
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
          Using the bot in a server?
        </summary>
        <div className="mt-3 overflow-hidden border border-border">
          <PairingStepTile
            step={1}
            title="Finish DM pairing first"
            className="border-b border-border"
            description="Server channels only work after you have linked your account in a private DM."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <PairingStepTile
              step={2}
              title="Enable Message Content Intent"
              className="border-b border-border sm:border-b-0 sm:border-r"
              description="Turn it on under Bot → Privileged Gateway Intents in the Developer Portal."
            />
            <PairingStepTile
              step={3}
              title="Re-invite the bot"
              className="border-b border-border"
              description="Discord only applies intent changes after you add the bot again with a fresh invite link."
            />
          </div>
          <PairingStepTile
            step={4}
            title="Trigger in channels"
            description="In a server channel, @mention the bot, reply to one of its messages, or use a slash command."
          />
        </div>
      </details>
    </div>
  );
}

function SettingsRow({
  label,
  description,
  layout = "inline",
  children,
}: {
  label: string;
  description?: ReactNode;
  layout?: "inline" | "stacked";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3",
        layout === "stacked"
          ? "flex flex-col gap-3"
          : "flex flex-wrap items-center justify-between gap-3",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {layout === "stacked" ? <div className="w-full min-w-0">{children}</div> : children}
    </div>
  );
}

export function DiscordSettingsCard({
  embedded = false,
  submitLabel = "Save",
  onSaveSuccess,
}: DiscordSettingsCardProps) {
  const { data: settings, isLoading, error: loadError } = useDiscordSettings();
  const { data: status } = useSystemStatusQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const saveMutation = useSaveDiscordSettings();
  const regenerateMutation = useRegenerateDiscordHandshake();

  const [botToken, setBotToken] = useState("");
  const [showBotToken, setShowBotToken] = useState(false);
  const [profileId, setProfileId] = useState("default");
  const [allowedUsers, setAllowedUsers] = useState<AllowedDiscordUser[]>([]);
  const [allowedUsersOpen, setAllowedUsersOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const pairingCode = settings?.handshakeCode ?? null;

  useEffect(() => {
    setCopied(false);
  }, [pairingCode]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const configured = settings?.configured === true;
  const isPaired = (settings?.pairedUserIds.length ?? 0) > 0;
  const hasAllowedUsers = (settings?.allowedUserIds.length ?? 0) > 0;
  const hasLinkedUsers = isPaired || hasAllowedUsers;
  const worker = status?.discordWorker;
  const running = worker?.running === true;
  const canSave = configured || botToken.trim().length > 0;
  const allowedUserSummary =
    allowedUsers.length === 0
      ? "No manual users"
      : `${allowedUsers.length} user${allowedUsers.length === 1 ? "" : "s"}`;

  const statusLine =
    hint ?? (formError ? formError : null) ?? (loadError ? formatError(loadError) : null);

  const headerSubtitle = !configured
    ? "Step 1: paste a bot token from Discord Developer Portal"
    : hasLinkedUsers && running
      ? "Your Discord is connected to Nakama"
      : hasLinkedUsers
        ? "Linked. Start the bridge to receive messages"
        : pairingCode
          ? "Step 2: send your pairing code to the bot in Discord"
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
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      setHint("Copy the code manually.");
    }
  }

  function handleSave(afterSuccess?: () => void) {
    setFormError(null);
    setHint(null);

    const request: UpdateDiscordSettingsRequest = {
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
        setHint("New code ready — send it to your bot in Discord.");
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
            <p className="text-sm font-medium text-foreground">Discord</p>
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

      <SettingsRow
        layout="stacked"
        label="Bot token"
        description={
          <>
            Create a bot in the{" "}
            <a
              href={DISCORD_DEVELOPER_PORTAL_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Discord Developer Portal
            </a>
            . Follow the{" "}
            <a
              href={DISCORD_SETUP_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              setup guide
            </a>{" "}
            for token, intents, and invite steps.
          </>
        }
      >
        <InputGroup className="w-full">
          <InputGroupInput
            id="discord-bot-token"
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
                ? "Discord is linked. Generate a new code to link another account."
                : pairingCode
                  ? "Send this code to your bot in Discord to finish linking."
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
                  className="min-w-[5.25rem] justify-center"
                  onClick={() => void copyHandshakeCode()}
                >
                  {copied ? (
                    <CheckIcon
                      className="size-3.5 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <CopyIcon className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
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
            <DiscordPairingGuide inviteUrl={settings?.inviteUrl ?? null} />
          ) : null}
        </div>
      ) : null}

      {configured ? (
        <SettingsRow
          label="Allowed users"
          description="Discord user IDs that can use this bot"
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
        <SettingsRow label="Reply as" description="Which agent answers on Discord">
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
            <SelectTrigger id="discord-profile" className="w-[11rem] sm:w-[13rem]">
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
            workerName="discord"
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
    <DiscordAllowedUsersDialog
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
