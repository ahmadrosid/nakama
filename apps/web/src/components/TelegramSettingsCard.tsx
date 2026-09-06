import type { UpdateTelegramSettingsRequest } from "@nakama/core/contract";
import { useEffect, useState } from "react";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import { TelegramAllowedUsersDialog } from "@/components/TelegramAllowedUsersDialog";
import { TelegramSettingsCardContent } from "@/components/telegram-settings-card-content";
import {
  useProfilesQuery,
  useRegenerateTelegramHandshake,
  useSaveTelegramSettings,
  useTelegramSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";
import type { AllowedTelegramUser } from "@/lib/parse-allowed-telegram-users";

interface TelegramSettingsCardProps {
  embedded?: boolean;
  onSaveSuccess?: () => void;
  submitLabel?: string;
}

function hydrateAllowedUsers(
  current: AllowedTelegramUser[],
  allowedUserIds: Array<string | number>
): AllowedTelegramUser[] {
  const existing = new Map(current.map((user) => [user.id, user]));
  return allowedUserIds.map((id) => {
    const stringId = String(id);
    return existing.get(stringId) ?? { id: stringId };
  });
}

function formatAllowedUserSummary(count: number): string {
  if (count === 0) {
    return "No manual users";
  }

  return `${count} user${count === 1 ? "" : "s"}`;
}

function settingsStatusLine(
  hint: string | null,
  formError: string | null,
  loadError: unknown
): string | null {
  if (hint) {
    return hint;
  }

  if (formError) {
    return formError;
  }

  if (loadError) {
    return formatError(loadError);
  }

  return null;
}

function telegramHeaderSubtitle(input: {
  configured: boolean;
  hasLinkedUsers: boolean;
  pairingCode: string | null;
  running: boolean;
}): string {
  if (!input.configured) {
    return "Step 1: paste a bot token from @BotFather";
  }

  if (input.hasLinkedUsers && input.running) {
    return "Your Telegram is connected to Nakama";
  }

  if (input.hasLinkedUsers) {
    return "Linked. Start the bridge to receive messages";
  }

  if (input.pairingCode) {
    return "Step 2: send your pairing code to the bot in Telegram";
  }

  return "Step 2: generate a pairing code and send it to your bot";
}

function telegramStatusBadge(input: {
  configured: boolean;
  hasLinkedUsers: boolean;
  running: boolean;
}): string {
  if (!input.configured) {
    return "Not set up";
  }

  if (input.hasLinkedUsers && input.running) {
    return "Connected";
  }

  if (input.hasLinkedUsers) {
    return "Paired";
  }

  return "Awaiting link";
}

function channelSaveHint(saved: {
  allowedUserIds: unknown[];
  handshakeCode?: string | null;
  pairedUserIds: unknown[];
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

function buildTelegramSaveRequest(
  allowedUsers: AllowedTelegramUser[],
  profileId: string,
  botToken: string
): UpdateTelegramSettingsRequest {
  const request: UpdateTelegramSettingsRequest = {
    allowedUserIds: allowedUsers.map((user) => user.id).join(","),
    profileId: profileId.trim() || "default",
  };

  if (botToken.trim()) {
    request.botToken = botToken.trim();
  }

  return request;
}

function TelegramSettingsLoading({ embedded }: { embedded: boolean }) {
  if (embedded) {
    return SETTINGS_CARD_LOADING_SKELETON;
  }

  return <div className="py-3">{SETTINGS_CARD_LOADING_SKELETON}</div>;
}

function useTelegramSettingsCard(onSaveSuccess?: () => void) {
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
    setAllowedUsers((current) =>
      hydrateAllowedUsers(current, settings.allowedUserIds)
    );
  }, [settings]);

  const configured = settings?.configured === true;
  const isPaired = (settings?.pairedUserIds.length ?? 0) > 0;
  const hasAllowedUsers = (settings?.allowedUserIds.length ?? 0) > 0;
  const hasLinkedUsers = isPaired || hasAllowedUsers;
  const pairingCode = settings?.handshakeCode ?? null;
  const worker = status?.telegramWorker;
  const running = worker?.running === true;

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

    saveMutation.mutate(
      buildTelegramSaveRequest(allowedUsers, profileId, botToken),
      {
        onError: (err) => {
          setFormError(formatError(err));
        },
        onSuccess: (saved) => {
          setBotToken("");
          setHint(channelSaveHint(saved));
          afterSuccess?.();
          onSaveSuccess?.();
        },
      }
    );
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

  return {
    allowedUserSummary: formatAllowedUserSummary(allowedUsers.length),
    allowedUsers,
    allowedUsersOpen,
    botToken,
    canSave: configured || botToken.trim().length > 0,
    configured,
    copyHandshakeCode,
    formError,
    handleRegenerateHandshake,
    handleSave,
    hasLinkedUsers,
    headerSubtitle: telegramHeaderSubtitle({
      configured,
      hasLinkedUsers,
      pairingCode,
      running,
    }),
    isLoading,
    isPaired,
    loadError,
    pairingCode,
    profileId,
    profiles,
    regeneratePending: regenerateMutation.isPending,
    running,
    savePending: saveMutation.isPending,
    setAllowedUsers,
    setAllowedUsersOpen,
    setBotToken,
    setFormError,
    setHint,
    setProfileId,
    setShowBotToken,
    settings,
    showBotToken,
    statusBadge: telegramStatusBadge({
      configured,
      hasLinkedUsers,
      running,
    }),
    statusLine: settingsStatusLine(hint, formError, loadError),
    worker,
  };
}

function TelegramSettingsCardLoaded({
  card,
  embedded,
  submitLabel,
}: {
  card: ReturnType<typeof useTelegramSettingsCard>;
  embedded: boolean;
  submitLabel: string;
}) {
  const content = (
    <TelegramSettingsCardContent
      allowedUserSummary={card.allowedUserSummary}
      botToken={card.botToken}
      formError={card.formError}
      headerSubtitle={card.headerSubtitle}
      loadError={card.loadError}
      onBotTokenChange={(value) => {
        card.setBotToken(value);
        card.setHint(null);
        if (card.formError) {
          card.setFormError(null);
        }
      }}
      onCopyHandshakeCode={() => void card.copyHandshakeCode()}
      onManageAllowedUsers={() => card.setAllowedUsersOpen(true)}
      onProfileChange={(value) => {
        card.setProfileId(value);
        card.setHint(null);
      }}
      onRegenerateHandshake={card.handleRegenerateHandshake}
      onSave={() => card.handleSave()}
      onToggleShowBotToken={() => card.setShowBotToken((current) => !current)}
      pairingCode={card.pairingCode}
      profileId={card.profileId}
      profiles={card.profiles}
      settings={card.settings}
      statusBadge={card.statusBadge}
      statusLine={card.statusLine}
      submitLabel={submitLabel}
      view={{
        canSave: card.canSave,
        configured: card.configured,
        embedded,
        hasLinkedUsers: card.hasLinkedUsers,
        isPaired: card.isPaired,
        regeneratePending: card.regeneratePending,
        running: card.running,
        savePending: card.savePending,
        showBotToken: card.showBotToken,
      }}
      worker={card.worker}
    />
  );

  const allowedUsersDialog = (
    <TelegramAllowedUsersDialog
      allowedUsers={card.allowedUsers}
      onAllowedUsersChange={card.setAllowedUsers}
      onError={card.setFormError}
      onOpenChange={card.setAllowedUsersOpen}
      onSaved={() => {
        card.setHint("Allowed users saved.");
        card.setFormError(null);
      }}
      open={card.allowedUsersOpen}
      profileId={card.profileId}
    />
  );

  if (embedded) {
    return (
      <>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">{card.headerSubtitle}</p>
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
  const card = useTelegramSettingsCard(onSaveSuccess);

  if (card.isLoading) {
    return <TelegramSettingsLoading embedded={embedded} />;
  }

  return (
    <TelegramSettingsCardLoaded
      card={card}
      embedded={embedded}
      submitLabel={submitLabel}
    />
  );
}
