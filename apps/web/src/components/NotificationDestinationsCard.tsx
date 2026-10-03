import type {
  CreateNotificationDestinationRequest,
  NotificationDestinationChannel,
  NotificationDestinationSummary,
  NotificationDestinationWithSecret,
} from "@nakama/core/contract";
import { normalizeCreateNotificationDestinationRequest } from "@nakama/core/notification-destinations";
import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from "hugeicons-react";
import { useEffect, useState } from "react";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useCreateNotificationDestination,
  useDeleteNotificationDestination,
  useNotificationDestinations,
  useNotificationWhatsAppSettings,
  useRegenerateNotificationDestinationKey,
  useUpdateNotificationDestination,
} from "@/hooks/use-notification-destinations";
import { formatError } from "@/lib/client";
import {
  buildNotificationWebhookUrl,
  formatNotificationDestinationLabel,
  maskWebhookApiKey,
  parseTelegramTopicLink,
} from "@/lib/notification-destinations";

function CopyButtonIcon({ copied }: { copied: boolean }) {
  const iconTransition =
    "absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-150 ease-[cubic-bezier(0.2,0,0,1)]";

  return (
    <span aria-hidden className="relative size-3.5 shrink-0">
      <Copy01Icon
        className={cn(
          iconTransition,
          copied
            ? "scale-[0.25] opacity-0 blur-[4px]"
            : "scale-100 opacity-100 blur-0"
        )}
      />
      <CheckmarkCircle01Icon
        className={cn(
          iconTransition,
          "text-emerald-600 dark:text-emerald-400",
          copied
            ? "scale-100 opacity-100 blur-0"
            : "scale-[0.25] opacity-0 blur-[4px]"
        )}
      />
    </span>
  );
}

function LatestSecret({
  latestSecret,
}: {
  latestSecret: NotificationDestinationWithSecret | null;
}) {
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [revealed, setRevealed] = useState(false);

  if (!latestSecret) {
    return null;
  }

  const apiKey = latestSecret.apiKey;
  const displayApiKey = revealed ? apiKey : maskWebhookApiKey(apiKey);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const webhookUrl = buildNotificationWebhookUrl(
    origin,
    latestSecret.destination.webhookPath
  );
  const curlExample = [
    `curl -X POST '${webhookUrl}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-API-Key: ${apiKey}' \\`,
    `  -H "Idempotency-Key: evt_$(date +%s)_$$" \\`,
    `  -d '{`,
    `    "title": "New notification",`,
    `    "body": "Hello from Nakama",`,
    `    "level": "info"`,
    `  }'`,
  ].join("\n");

  async function copyCurlExample() {
    try {
      await navigator.clipboard.writeText(curlExample);
      setCopiedCurl(true);
      window.setTimeout(() => setCopiedCurl(false), 2000);
    } catch {
      setCopiedCurl(false);
    }
  }

  async function copyApiKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedApiKey(true);
      window.setTimeout(() => setCopiedApiKey(false), 2000);
    } catch {
      setCopiedApiKey(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground text-sm">
            Latest webhook credentials ready
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label={revealed ? "Hide API key" : "Reveal API key"}
            className="min-w-[6.75rem] justify-center"
            onClick={() => setRevealed((current) => !current)}
            size="sm"
            type="button"
            variant="outline"
          >
            {revealed ? (
              <ViewOffIcon className="size-3.5" />
            ) : (
              <ViewIcon className="size-3.5" />
            )}
            {revealed ? "Hide" : "Reveal"}
          </Button>
          <Button
            className="min-w-[6.75rem] justify-center"
            onClick={() => void copyCurlExample()}
            size="sm"
            type="button"
            variant="outline"
          >
            <CopyButtonIcon copied={copiedCurl} />
            {copiedCurl ? "Copied" : "Copy curl"}
          </Button>
          <Button
            className="min-w-[7.5rem] justify-center"
            onClick={() => void copyApiKey()}
            size="sm"
            type="button"
            variant="outline"
          >
            <CopyButtonIcon copied={copiedApiKey} />
            {copiedApiKey ? "Copied key" : "Copy API key"}
          </Button>
        </div>
      </div>

      <details className="group mt-3">
        <summary className="cursor-pointer rounded-md px-1 py-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
          Show webhook details
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-muted-foreground text-xs">Webhook URL</p>
            <code className="block break-all text-foreground text-xs">
              {webhookUrl}
            </code>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">API key</p>
            <code className="block break-all text-foreground text-xs">
              {displayApiKey}
            </code>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Example curl</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-3 text-foreground text-xs">
              <code>{curlExample.replace(apiKey, displayApiKey)}</code>
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

function isWhatsAppRecipientReady(
  settings: ReturnType<typeof useNotificationWhatsAppSettings>
): boolean {
  return !!settings.data?.pairedJid && !settings.isLoading && !settings.error;
}

function isDestinationRequestValid(value: unknown): boolean {
  try {
    normalizeCreateNotificationDestinationRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function NotificationDestinationsCard() {
  const { data: profiles = [] } = useProfilesQuery();
  const [profileId, setProfileId] = useState("");
  const [channel, setChannel] =
    useState<NotificationDestinationChannel>("telegram");
  const [target, setTarget] = useState("");
  const whatsapp = useNotificationWhatsAppSettings(
    profileId,
    channel === "whatsapp"
  );
  const whatsappReady = isWhatsAppRecipientReady(whatsapp);
  const { data, isLoading, error } = useNotificationDestinations();
  const createMutation = useCreateNotificationDestination();
  const rotateMutation = useRegenerateNotificationDestinationKey();
  const deleteMutation = useDeleteNotificationDestination();
  const [deleteTarget, setDeleteTarget] =
    useState<NotificationDestinationSummary | null>(null);

  const [name, setName] = useState("");
  const [latestSecret, setLatestSecret] =
    useState<NotificationDestinationWithSecret | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const destinations = data?.destinations ?? [];
  const configs = {
    discord: { channelId: target, profileId },
    telegram: { ...parseTelegramTopicLink(target), profileId },
    whatsapp: { profileId },
  };
  const defaultNames = {
    discord: `Discord channel ${target.trim()}`,
    telegram: `Telegram topic ${configs.telegram.topicId ?? ""}`,
    whatsapp: "WhatsApp notifications",
  };
  const requestInput = {
    channel,
    name: name.trim() || defaultNames[channel],
    [channel]: configs[channel],
  };

  useEffect(() => {
    if (!latestSecret) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLatestSecret(null);
    }, 60_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [latestSecret]);

  function resetForm() {
    setName("");
    setTarget("");
  }

  function handleCreate() {
    setFormError(null);
    if (channel === "whatsapp" && !whatsappReady) {
      setFormError("Pair this agent's WhatsApp connection first.");
      return;
    }
    let request: CreateNotificationDestinationRequest;
    try {
      request = normalizeCreateNotificationDestinationRequest(requestInput);
    } catch (error) {
      setFormError(formatError(error));
      return;
    }

    createMutation.mutate(request, {
      onError: (mutationError) => {
        setFormError(formatError(mutationError));
      },
      onSuccess: (created) => {
        setLatestSecret(created);
        resetForm();
      },
    });
  }

  async function handleRotate(destinationId: string) {
    setFormError(null);

    rotateMutation.mutate(destinationId, {
      onError: (mutationError) => {
        setFormError(formatError(mutationError));
      },
      onSuccess: (rotated) => {
        setLatestSecret(rotated);
      },
    });
  }

  async function handleDelete(destinationId: string) {
    setFormError(null);
    await deleteMutation.mutateAsync(destinationId);
    if (latestSecret?.destination.id === destinationId) {
      setLatestSecret(null);
    }
  }

  return (
    <div className="space-y-8">
      <label className="flex flex-col gap-2 text-sm">
        Agent
        <select
          className="rounded-md border bg-background p-2"
          onChange={(event) => setProfileId(event.target.value)}
          value={profileId}
        >
          <option value="">Choose an agent</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <p className="px-4 py-3 font-medium text-foreground text-sm">
          Notification destinations
        </p>
        <label className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <span className="shrink-0 text-foreground text-sm sm:w-36">
            Channel
          </span>
          <select
            className="min-w-0 flex-1 rounded-md border bg-background p-2 text-sm"
            onChange={(event) => {
              setChannel(event.target.value as NotificationDestinationChannel);
              setTarget("");
              setFormError(null);
            }}
            value={channel}
          >
            <option value="telegram">Telegram</option>
            <option value="discord">Discord</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <span className="shrink-0 text-foreground text-sm sm:w-36">Name</span>
          <Input
            className="min-w-0 flex-1"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <div className="px-4 py-3">
          <NotificationTargetFields
            channel={channel}
            onTargetChange={setTarget}
            target={target}
            whatsapp={whatsapp}
          />
        </div>
        <div className="flex justify-end px-4 py-3">
          <Button
            disabled={
              createMutation.isPending ||
              !isDestinationRequestValid(requestInput) ||
              (channel === "whatsapp" && !whatsappReady)
            }
            onClick={handleCreate}
            size="sm"
          >
            {createMutation.isPending ? <Spinner className="size-4" /> : null}
            Create destination
          </Button>
        </div>
      </div>

      {formError ? (
        <p className="text-destructive text-sm">{formError}</p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm">{formatError(error)}</p>
      ) : null}

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex min-h-24 items-center justify-center text-muted-foreground text-sm">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {!isLoading && destinations.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
            No notification destinations yet.
          </div>
        ) : null}
        {!isLoading &&
          destinations.map((destination) => (
            <NotificationDestinationItem
              deletePending={deleteMutation.isPending}
              destination={destination}
              key={destination.id}
              latestSecret={latestSecret}
              onDelete={() => setDeleteTarget(destination)}
              onRotate={() => handleRotate(destination.id)}
              profiles={profiles}
              rotatePending={rotateMutation.isPending}
            />
          ))}
      </div>
      {deleteTarget ? (
        <ConfirmDialog
          description={`Delete "${deleteTarget.name}"? Its webhook will stop accepting notifications.`}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget.id)}
          title="Delete notification destination?"
        />
      ) : null}
    </div>
  );
}

function NotificationTargetFields({
  channel,
  target,
  onTargetChange,
  topicId,
  onTopicIdChange,
  whatsapp,
}: {
  channel: NotificationDestinationChannel;
  target: string;
  onTargetChange: (value: string) => void;
  topicId?: string;
  onTopicIdChange?: (value: string) => void;
  whatsapp: ReturnType<typeof useNotificationWhatsAppSettings>;
}) {
  if (channel === "whatsapp") {
    return (
      <div className="space-y-1 text-sm">
        <p>
          Recipient:{" "}
          {whatsapp.isLoading
            ? "Loading…"
            : whatsapp.data?.pairedJid || "Not paired"}
        </p>
        <p className="text-muted-foreground text-xs">
          Uses this agent's current paired contact. Changing the pairing changes
          the recipient.
        </p>
        {whatsapp.error ? (
          <p className="text-destructive">{formatError(whatsapp.error)}</p>
        ) : null}
      </div>
    );
  }
  const isTopicLink = channel === "telegram" && topicId === undefined;
  const labels = {
    discord: "Discord channel ID",
    telegram: isTopicLink ? "Telegram topic link" : "Telegram chat ID",
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        {labels[channel]}
        <Input
          onChange={(event) => onTargetChange(event.target.value)}
          placeholder={
            isTopicLink ? "https://t.me/c/3734526664/167" : undefined
          }
          value={target}
        />
      </label>
      {channel === "telegram" && topicId !== undefined ? (
        <label className="flex flex-col gap-1.5 text-sm">
          Telegram topic ID
          <Input
            onChange={(event) => onTopicIdChange?.(event.target.value)}
            placeholder="Leave blank to remove topic"
            value={topicId}
          />
        </label>
      ) : null}
    </div>
  );
}

function NotificationDestinationItem({
  destination,
  profiles,
  latestSecret,
  rotatePending,
  deletePending,
  onRotate,
  onDelete,
}: {
  destination: NotificationDestinationSummary;
  profiles: Array<{ id: string; name: string }>;
  latestSecret: NotificationDestinationWithSecret | null;
  rotatePending: boolean;
  deletePending: boolean;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const updateMutation = useUpdateNotificationDestination();
  const [draft, setDraft] = useState<{
    name: string;
    profileId: string;
    target: string;
    topicId: string;
  } | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const whatsapp = useNotificationWhatsAppSettings(
    draft?.profileId ?? "",
    destination.channel === "whatsapp" && !!draft
  );
  const whatsappReady = isWhatsAppRecipientReady(whatsapp);

  function startEditing() {
    setEditingError(null);
    const config =
      destination.channel === "telegram"
        ? destination.telegram
        : destination.channel === "discord"
          ? destination.discord
          : destination.whatsapp;
    setDraft({
      name: destination.name,
      profileId: config.profileId ?? "",
      target:
        destination.channel === "telegram"
          ? String(destination.telegram.chatId)
          : destination.channel === "discord"
            ? destination.discord.channelId
            : "",
      topicId:
        destination.channel === "telegram"
          ? (destination.telegram.topicId?.toString() ?? "")
          : "",
    });
  }

  const configs = {
    discord: { channelId: draft?.target, profileId: draft?.profileId },
    telegram: {
      chatId: Number(draft?.target),
      profileId: draft?.profileId,
      topicId: draft?.topicId.trim() ? Number(draft.topicId) : null,
    },
    whatsapp: { profileId: draft?.profileId },
  };
  const requestInput = {
    channel: destination.channel,
    name: draft?.name,
    [destination.channel]: configs[destination.channel],
  };

  function save() {
    if (!draft) {
      return;
    }
    setEditingError(null);
    let request: CreateNotificationDestinationRequest;
    if (destination.channel === "whatsapp" && !whatsappReady) {
      setEditingError("Pair this agent's WhatsApp connection first.");
      return;
    }
    try {
      request = normalizeCreateNotificationDestinationRequest(requestInput);
    } catch (error) {
      setEditingError(formatError(error));
      return;
    }
    updateMutation.mutate(
      { destinationId: destination.id, request },
      {
        onError: (error) => setEditingError(formatError(error)),
        onSuccess: () => setDraft(null),
      }
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground text-sm">
            {destination.name}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatNotificationDestinationLabel(destination)}
          </p>
          <code className="block break-all text-muted-foreground text-xs">
            {destination.webhookPath}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <Button
            className="min-h-10"
            disabled={updateMutation.isPending}
            onClick={() => (draft ? setDraft(null) : startEditing())}
            size="sm"
            type="button"
            variant="outline"
          >
            {draft ? "Cancel" : "Edit"}
          </Button>
          <Button
            className="min-h-10"
            disabled={rotatePending}
            onClick={onRotate}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshIcon aria-hidden className="size-3.5" />
            Rotate key
          </Button>
          <Button
            className="min-h-10"
            disabled={deletePending}
            onClick={onDelete}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Delete02Icon aria-hidden className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {draft ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-1 flex-col gap-1.5 text-xs">
              Name
              <Input
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                value={draft.name}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-xs">
              Agent
              <select
                className="rounded-md border bg-background p-2 text-sm"
                onChange={(event) =>
                  setDraft({ ...draft, profileId: event.target.value })
                }
                value={draft.profileId}
              >
                <option value="">Choose an agent</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <NotificationTargetFields
                channel={destination.channel}
                onTargetChange={(target) => setDraft({ ...draft, target })}
                onTopicIdChange={(topicId) => setDraft({ ...draft, topicId })}
                target={draft.target}
                topicId={draft.topicId}
                whatsapp={whatsapp}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={
                  updateMutation.isPending ||
                  !isDestinationRequestValid(requestInput) ||
                  (destination.channel === "whatsapp" && !whatsappReady)
                }
                onClick={save}
                size="sm"
                type="button"
              >
                {updateMutation.isPending ? (
                  <Spinner className="size-3.5" />
                ) : null}
                Save
              </Button>
              <Button
                disabled={updateMutation.isPending}
                onClick={() => setDraft(null)}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>
          {editingError ? (
            <p className="mt-2 text-destructive text-sm">{editingError}</p>
          ) : null}
        </div>
      ) : null}

      {latestSecret?.destination.id === destination.id ? (
        <LatestSecret key={latestSecret.apiKey} latestSecret={latestSecret} />
      ) : null}
    </div>
  );
}
