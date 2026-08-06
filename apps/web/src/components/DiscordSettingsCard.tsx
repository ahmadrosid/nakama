import { useEffect, useRef, useState } from "react";
import type { UpdateDiscordSettingsRequest } from "@nakama/core/contract";
import {
  DiscordAllowedUsersDialog,
  type AllowedDiscordUser,
} from "@/components/DiscordAllowedUsersDialog";
import { DiscordSettingsCardContent } from "@/components/discord-settings-card-content";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import { Card, CardContent } from "@/components/ui/card";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import {
  useRegenerateDiscordHandshake,
  useSaveDiscordSettings,
  useDiscordSettings,
} from "@/hooks/use-discord-settings";
import { formatError } from "@/lib/client";

interface DiscordSettingsCardProps {
  embedded?: boolean;
  submitLabel?: string;
  onSaveSuccess?: () => void;
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
    <DiscordSettingsCardContent
      view={{
        embedded,
        configured,
        hasLinkedUsers,
        running,
        showBotToken,
        savePending: saveMutation.isPending,
        isPaired,
        copied,
        regeneratePending: regenerateMutation.isPending,
        canSave,
      }}
      headerSubtitle={headerSubtitle}
      statusBadge={statusBadge}
      settings={settings}
      botToken={botToken}
      onBotTokenChange={(value) => {
        setBotToken(value);
        setHint(null);
        if (formError) {
          setFormError(null);
        }
      }}
      onToggleShowBotToken={() => setShowBotToken((current) => !current)}
      pairingCode={pairingCode}
      onCopyHandshakeCode={() => void copyHandshakeCode()}
      onRegenerateHandshake={handleRegenerateHandshake}
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
      submitLabel={submitLabel}
      onSave={() => handleSave()}
    />
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
