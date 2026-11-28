import type { UpdateTelegramSettingsRequest } from "@nakama/core/contract";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import { TelegramAllowedUsers } from "@/components/TelegramAllowedUsers";
import { TelegramSettingsCardContent } from "@/components/telegram-settings-card-content";
import { useAgentGroupsQuery } from "@/hooks/use-agent-groups";
import {
  useChannelProfileId,
  useRegenerateTelegramHandshake,
  useSaveTelegramSettings,
  useTelegramSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { useStartWorker } from "@/hooks/use-worker-actions";
import { client, formatError } from "@/lib/client";
import type { AllowedTelegramUser } from "@/lib/parse-allowed-telegram-users";

interface TelegramSettingsCardProps {
  embedded?: boolean;
  onSaveSuccess?: () => void;
  submitLabel?: string;
}

const ANSWER_AS_AGENT = "agent";

/** Who the bot answers as: its own agent, or one of the caller's Agent Groups. */
function TelegramAgentGroupSelect({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["telegram-agent-group", profileId];
  const groups = useAgentGroupsQuery();

  const target = useQuery({
    queryFn: () => client.getTelegramAgentGroup(profileId),
    queryKey,
  });

  const save = useMutation({
    mutationFn: (groupId: string | null) =>
      client.setTelegramAgentGroup(profileId, groupId),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  // Unknown until the target loads: the select then shows no choice.
  const value = target.data ? (target.data.groupId ?? ANSWER_AS_AGENT) : "";
  const selected = groups.data?.find((group) => group.id === value);
  const error = target.error ?? save.error;

  return (
    <div className="space-y-1.5 py-3">
      <p className="font-medium text-sm">Answer as</p>
      <Select
        disabled={!target.data || save.isPending}
        onValueChange={(next) =>
          save.mutate(next === ANSWER_AS_AGENT ? null : next)
        }
        value={value}
      >
        <SelectTrigger aria-label="Answer as" className="w-64">
          <SelectValue>
            {value === ANSWER_AS_AGENT
              ? "This agent"
              : value && (selected?.name ?? "Agent Group")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANSWER_AS_AGENT}>This agent</SelectItem>
          {groups.data?.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Kept: a group runs with the access of the person who picks it. */}
      <p className="text-muted-foreground text-xs">
        An Agent Group answers as you.
      </p>
      {error ? (
        <p className="text-destructive text-xs">{formatError(error)}</p>
      ) : null}
    </div>
  );
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

function settingsStatusLine(
  hint: string | null,
  formError: string | null,
  loadError: Error | null
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
  const ownerProfileId = useChannelProfileId();

  const {
    data: settings,
    isLoading,
    error: loadError,
    refetch,
  } = useTelegramSettings();

  const { data: status } = useSystemStatusQuery();
  const saveMutation = useSaveTelegramSettings();
  const startMutation = useStartWorker();
  const savingRef = useRef(false);
  const regenerateMutation = useRegenerateTelegramHandshake();

  const [botToken, setBotToken] = useState("");
  const [showBotToken, setShowBotToken] = useState(false);
  const [profileId, setProfileId] = useState("default");
  const [allowedUsers, setAllowedUsers] = useState<AllowedTelegramUser[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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

  const configured = settings?.configured === true;
  const isPaired = (settings?.pairedUserIds.length ?? 0) > 0;
  const hasAllowedUsers = (settings?.allowedUserIds.length ?? 0) > 0;
  const hasLinkedUsers = isPaired || hasAllowedUsers;
  const pairingCode = settings?.handshakeCode ?? null;
  const worker = status?.telegramWorker;
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
      setHint("Code copied — paste it in Telegram.");
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
        buildTelegramSaveRequest(allowedUsers, profileId, token)
      );

      setBotToken("");

      if (!configured && worker?.process?.managed) {
        await startMutation.mutateAsync("telegram");
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
        setHint("New code ready — send it to your bot in Telegram.");
      },
    });
  }

  return {
    allowedUsers,
    botToken,
    canSave: botToken.trim().length > 0,
    configured,
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
    setBotToken,
    setFormError,
    setHint,
    setShowBotToken,
    settings,
    showBotToken,
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
      allowedUsersPanel={
        <TelegramAllowedUsers
          allowedUsers={card.allowedUsers}
          onAllowedUsersChange={card.setAllowedUsers}
          onError={card.setFormError}
          onSaved={() => {
            card.setHint("Allowed users saved.");
            card.setFormError(null);
          }}
          profileId={card.profileId}
        />
      }
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
      onRegenerateHandshake={card.handleRegenerateHandshake}
      onSave={() => void card.handleSave()}
      onToggleShowBotToken={() => card.setShowBotToken((current) => !current)}
      pairingCode={card.pairingCode}
      profileId={card.profileId}
      settings={card.settings}
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

  return card.configured ? (
    <>
      {content}
      <TelegramAgentGroupSelect profileId={card.profileId} />
    </>
  ) : (
    content
  );
}

export function TelegramSettingsCard({
  embedded = false,
  submitLabel = "Save changes",
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
