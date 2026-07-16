import { useEffect, useState } from "react";
import type { UpdateTelegramSettingsRequest } from "@nakama/core/contract";
import {
  TelegramAllowedUsersDialog,
  type AllowedTelegramUser,
} from "@/components/TelegramAllowedUsersDialog";
import { TelegramSettingsCardContent } from "@/components/telegram-settings-card-content";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import { Card, CardContent } from "@/components/ui/card";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import {
  useRegenerateTelegramHandshake,
  useSaveTelegramSettings,
  useTelegramSettings,
} from "@/hooks/use-telegram-settings";
import { formatError } from "@/lib/client";

interface TelegramSettingsCardProps {
  embedded?: boolean;
  submitLabel?: string;
  onSaveSuccess?: () => void;
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
    if (embedded) {
      return SETTINGS_CARD_LOADING_SKELETON;
    }

    return (
      <Card className="w-full shadow-none">
        <CardContent className="py-3">{SETTINGS_CARD_LOADING_SKELETON}</CardContent>
      </Card>
    );
  }

  const content = (
    <TelegramSettingsCardContent
      embedded={embedded}
      headerSubtitle={headerSubtitle}
      statusBadge={statusBadge}
      configured={configured}
      settings={settings}
      hasLinkedUsers={hasLinkedUsers}
      running={running}
      botToken={botToken}
      showBotToken={showBotToken}
      onBotTokenChange={(value) => {
        setBotToken(value);
        setHint(null);
        if (formError) {
          setFormError(null);
        }
      }}
      onToggleShowBotToken={() => setShowBotToken((current) => !current)}
      savePending={saveMutation.isPending}
      isPaired={isPaired}
      pairingCode={pairingCode}
      onCopyHandshakeCode={() => void copyHandshakeCode()}
      onRegenerateHandshake={handleRegenerateHandshake}
      regeneratePending={regenerateMutation.isPending}
      allowedUserSummary={allowedUserSummary}
      onManageAllowedUsers={() => setAllowedUsersOpen(true)}
      profileId={profileId}
      profiles={profiles}
      onProfileChange={(value) => {
        setProfileId(value);
        setHint(null);
      }}
      worker={worker}
      statusLine={statusLine}
      formError={formError}
      loadError={loadError}
      canSave={canSave}
      submitLabel={submitLabel}
      onSave={() => handleSave()}
    />
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
