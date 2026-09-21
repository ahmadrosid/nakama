import type { UpdateDiscordSettingsRequest } from "@nakama/core/contract";
import { useEffect, useRef, useState } from "react";
import {
  type AllowedDiscordUser,
  DiscordAllowedUsersDialog,
} from "@/components/DiscordAllowedUsersDialog";
import { DiscordSettingsCardContent } from "@/components/discord-settings-card-content";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import {
  useChannelProfileId,
  useDiscordSettings,
  useRegenerateDiscordHandshake,
  useSaveDiscordSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { useStartWorker } from "@/hooks/use-worker-actions";
import { formatError } from "@/lib/client";

interface DiscordSettingsCardProps {
  embedded?: boolean;
  onSaveSuccess?: () => void;
  submitLabel?: string;
}

function hydrateAllowedUsers(
  current: AllowedDiscordUser[],
  allowedUserIds: Array<string | number>
): AllowedDiscordUser[] {
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

function discordStatusBadge(input: {
  configured: boolean;
  hasLinkedUsers: boolean;
  running: boolean;
  connected: boolean;
}): string {
  if (!input.configured) {
    return "Not set up";
  }

  if (input.hasLinkedUsers && input.running && input.connected) {
    return "Connected";
  }

  if (input.hasLinkedUsers) {
    return "Offline";
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

function buildDiscordSaveRequest(
  allowedUsers: AllowedDiscordUser[],
  profileId: string,
  botToken: string
): UpdateDiscordSettingsRequest {
  const request: UpdateDiscordSettingsRequest = {
    allowedUserIds: allowedUsers.map((user) => user.id).join(","),
    profileId: profileId.trim() || "default",
  };

  if (botToken.trim()) {
    request.botToken = botToken.trim();
  }

  return request;
}

function DiscordSettingsLoading({ embedded }: { embedded: boolean }) {
  if (embedded) {
    return SETTINGS_CARD_LOADING_SKELETON;
  }

  return <div className="py-3">{SETTINGS_CARD_LOADING_SKELETON}</div>;
}

function useDiscordSettingsCard(onSaveSuccess?: () => void) {
  const ownerProfileId = useChannelProfileId();
  const {
    data: settings,
    isLoading,
    error: loadError,
    refetch,
  } = useDiscordSettings();
  const { data: status } = useSystemStatusQuery();
  const saveMutation = useSaveDiscordSettings();
  const startMutation = useStartWorker();
  const savingRef = useRef(false);
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

    setProfileId(ownerProfileId ?? settings.profileId);
    setBotToken("");
    setAllowedUsers((current) =>
      hydrateAllowedUsers(current, settings.allowedUserIds)
    );
  }, [settings, ownerProfileId]);

  const pairingCode = settings?.handshakeCode ?? null;

  useEffect(() => {
    setCopied(false);
  }, [pairingCode]);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  const configured = settings?.configured === true;
  const isPaired = (settings?.pairedUserIds.length ?? 0) > 0;
  const hasAllowedUsers = (settings?.allowedUserIds.length ?? 0) > 0;
  const hasLinkedUsers = isPaired || hasAllowedUsers;
  const worker = status?.discordWorker;
  const running = worker?.running === true;
  useEffect(() => {
    if (worker?.paired && !hasLinkedUsers) {
      void refetch();
    }
  }, [worker?.paired, hasLinkedUsers, refetch]);

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

  async function handleSave(token = botToken) {
    if (savingRef.current || !token.trim()) {
      return;
    }
    savingRef.current = true;
    setFormError(null);
    setHint(null);

    try {
      const saved = await saveMutation.mutateAsync(
        buildDiscordSaveRequest(allowedUsers, profileId, token)
      );
      setBotToken("");
      if (!configured && worker?.process?.managed) {
        await startMutation.mutateAsync("discord");
      }
      setHint(channelSaveHint(saved));
      onSaveSuccess?.();
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      savingRef.current = false;
    }
  }

  function handleRegenerateHandshake() {
    setFormError(null);
    setHint(null);

    regenerateMutation.mutate(undefined, {
      onError: (err) => {
        setFormError(formatError(err));
      },
      onSuccess: () => {
        setHint("New code ready — send it to your bot in Discord.");
      },
    });
  }

  return {
    allowedUserSummary: formatAllowedUserSummary(allowedUsers.length),
    allowedUsers,
    allowedUsersOpen,
    botToken,
    canSave: botToken.trim().length > 0,
    configured,
    copied,
    copyHandshakeCode,
    formError,
    handleRegenerateHandshake,
    handleSave,
    hasLinkedUsers,
    isLoading,
    isPaired,
    loadError,
    pairingCode,
    profileId,
    regeneratePending: regenerateMutation.isPending,
    running,
    savePending: saveMutation.isPending || startMutation.isPending,
    setAllowedUsers,
    setAllowedUsersOpen,
    setBotToken,
    setFormError,
    setHint,
    setShowBotToken,
    settings,
    showBotToken,
    statusBadge: discordStatusBadge({
      configured,
      connected: worker?.connected === true,
      hasLinkedUsers,
      running,
    }),
    statusLine: settingsStatusLine(hint, formError, loadError),
    worker,
  };
}

function DiscordSettingsCardLoaded({
  card,
  embedded,
  submitLabel,
}: {
  card: ReturnType<typeof useDiscordSettingsCard>;
  embedded: boolean;
  submitLabel: string;
}) {
  const content = (
    <DiscordSettingsCardContent
      allowedUserSummary={card.allowedUserSummary}
      botToken={card.botToken}
      formError={card.formError}
      loadError={card.loadError}
      onBotTokenChange={(value) => {
        card.setBotToken(value);
        card.setHint(null);
        if (card.formError) {
          card.setFormError(null);
        }
      }}
      onBotTokenPaste={(value) => {
        card.setBotToken(value);
        void card.handleSave(value);
      }}
      onCopyHandshakeCode={() => void card.copyHandshakeCode()}
      onManageAllowedUsers={() => card.setAllowedUsersOpen(true)}
      onRegenerateHandshake={card.handleRegenerateHandshake}
      onSave={() => void card.handleSave()}
      onToggleShowBotToken={() => card.setShowBotToken((current) => !current)}
      pairingCode={card.pairingCode}
      settings={card.settings}
      statusBadge={card.statusBadge}
      statusLine={card.statusLine}
      submitLabel={submitLabel}
      view={{
        canSave: card.canSave,
        configured: card.configured,
        copied: card.copied,
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
    <DiscordAllowedUsersDialog
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

  return (
    <>
      {content}
      {allowedUsersDialog}
    </>
  );
}

export function DiscordSettingsCard({
  embedded = false,
  submitLabel = "Save changes",
  onSaveSuccess,
}: DiscordSettingsCardProps) {
  const card = useDiscordSettingsCard(onSaveSuccess);

  if (card.isLoading) {
    return <DiscordSettingsLoading embedded={embedded} />;
  }

  return (
    <DiscordSettingsCardLoaded
      card={card}
      embedded={embedded}
      submitLabel={card.configured ? submitLabel : "Connect Discord"}
    />
  );
}
