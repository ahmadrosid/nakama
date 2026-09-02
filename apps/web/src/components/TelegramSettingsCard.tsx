import type { UpdateTelegramSettingsRequest } from "@nakama/core/contract";
import { type ReactNode, useEffect, useState } from "react";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import {
  type AllowedTelegramUser,
  TelegramAllowedUsersDialog,
} from "@/components/TelegramAllowedUsersDialog";
import { TelegramSettingsCardContent } from "@/components/telegram-settings-card-content";
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
  onSaveSuccess?: () => void;
  submitLabel?: string;
}

function allowedUsersSummaryLabel(count: number): string {
  if (count === 0) {
    return "No manual users";
  }
  return `${count} user${count === 1 ? "" : "s"}`;
}

function resolveTelegramStatusCopy(input: {
  configured: boolean;
  hasLinkedUsers: boolean;
  pairingCode: string | null;
  running: boolean;
}): { headerSubtitle: string; statusBadge: string } {
  if (!input.configured) {
    return {
      headerSubtitle: "Step 1: paste a bot token from @BotFather",
      statusBadge: "Not set up",
    };
  }

  if (input.hasLinkedUsers && input.running) {
    return {
      headerSubtitle: "Your Telegram is connected to Nakama",
      statusBadge: "Connected",
    };
  }

  if (input.hasLinkedUsers) {
    return {
      headerSubtitle: "Linked. Start the bridge to receive messages",
      statusBadge: "Paired",
    };
  }

  if (input.pairingCode) {
    return {
      headerSubtitle: "Step 2: send your pairing code to the bot in Telegram",
      statusBadge: "Awaiting link",
    };
  }

  return {
    headerSubtitle: "Step 2: generate a pairing code and send it to your bot",
    statusBadge: "Awaiting link",
  };
}

function telegramSaveHint(saved: {
  handshakeCode?: string | null;
  pairedUserIds: unknown[];
  allowedUserIds: unknown[];
}): string {
  const savedHasLinkedUsers =
    saved.pairedUserIds.length > 0 || saved.allowedUserIds.length > 0;

  if (saved.handshakeCode && !savedHasLinkedUsers) {
    return "Saved. Send the pairing code to your bot.";
  }

  if (savedHasLinkedUsers) {
    return "Saved.";
  }

  return "Saved. Get a pairing code if you still need to link.";
}

function TelegramSettingsCardShell({
  embedded,
  headerSubtitle,
  content,
  allowedUsersDialog,
}: {
  embedded: boolean;
  headerSubtitle: string;
  content: ReactNode;
  allowedUsersDialog: ReactNode;
}) {
  if (embedded) {
    return (
      <>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">{headerSubtitle}</p>
          {content}
        </div>
        {allowedUsersDialog}
      </>
    );
  }

  return (
    <>
      {content}
      {allowedUsersDialog}
    </>
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
  const allowedUserSummary = allowedUsersSummaryLabel(allowedUsers.length);
  const statusLine =
    hint ??
    (formError ? formError : null) ??
    (loadError ? formatError(loadError) : null);
  const { headerSubtitle, statusBadge } = resolveTelegramStatusCopy({
    configured,
    hasLinkedUsers,
    pairingCode,
    running,
  });

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
      onError: (err) => {
        setFormError(formatError(err));
      },
      onSuccess: (saved) => {
        setBotToken("");
        setHint(telegramSaveHint(saved));
        afterSuccess?.();
        onSaveSuccess?.();
      },
    });
  }

  function handleRegenerateHandshake() {
    setFormError(null);
    setHint(null);

    regenerateMutation.mutate(undefined, {
      onError: (err) => {
        setFormError(formatError(err));
      },
      onSuccess: () => {
        setHint("New code ready — send it to your bot in Telegram.");
      },
    });
  }

  if (isLoading) {
    if (embedded) {
      return SETTINGS_CARD_LOADING_SKELETON;
    }

    return <div className="py-3">{SETTINGS_CARD_LOADING_SKELETON}</div>;
  }

  const content = (
    <TelegramSettingsCardContent
      allowedUserSummary={allowedUserSummary}
      botToken={botToken}
      formError={formError}
      headerSubtitle={headerSubtitle}
      loadError={loadError}
      onBotTokenChange={(value) => {
        setBotToken(value);
        setHint(null);
        if (formError) {
          setFormError(null);
        }
      }}
      onCopyHandshakeCode={() => void copyHandshakeCode()}
      onManageAllowedUsers={() => setAllowedUsersOpen(true)}
      onProfileChange={(value) => {
        setProfileId(value);
        setHint(null);
      }}
      onRegenerateHandshake={handleRegenerateHandshake}
      onSave={() => handleSave()}
      onToggleShowBotToken={() => setShowBotToken((current) => !current)}
      pairingCode={pairingCode}
      profileId={profileId}
      profiles={profiles}
      settings={settings}
      statusBadge={statusBadge}
      statusLine={statusLine}
      submitLabel={submitLabel}
      view={{
        canSave,
        configured,
        embedded,
        hasLinkedUsers,
        isPaired,
        regeneratePending: regenerateMutation.isPending,
        running,
        savePending: saveMutation.isPending,
        showBotToken,
      }}
      worker={worker}
    />
  );

  const allowedUsersDialog = (
    <TelegramAllowedUsersDialog
      allowedUsers={allowedUsers}
      onAllowedUsersChange={setAllowedUsers}
      onError={setFormError}
      onOpenChange={setAllowedUsersOpen}
      onSaved={() => {
        setHint("Allowed users saved.");
        setFormError(null);
      }}
      open={allowedUsersOpen}
      profileId={profileId}
    />
  );

  return (
    <TelegramSettingsCardShell
      allowedUsersDialog={allowedUsersDialog}
      content={content}
      embedded={embedded}
      headerSubtitle={headerSubtitle}
    />
  );
}
