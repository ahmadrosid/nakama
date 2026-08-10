import type { NotificationDestinationWithSecret } from "@nakama/core/contract";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  Delete02Icon,
  RefreshIcon,
} from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  useCreateNotificationDestination,
  useDeleteNotificationDestination,
  useNotificationDestinations,
  useRegenerateNotificationDestinationKey,
  useUpdateNotificationDestination,
} from "@/hooks/use-notification-destinations";
import { formatError } from "@/lib/client";
import {
  buildNotificationWebhookUrl,
  formatTelegramDestinationLabel,
  parseTelegramTopicLink,
} from "@/lib/notification-destinations";
import { cn } from "@/lib/utils";

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

  if (!latestSecret) {
    return null;
  }

  const apiKey = latestSecret.apiKey;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const webhookUrl = buildNotificationWebhookUrl(
    origin,
    latestSecret.destination.webhookPath
  );
  const curlExample = [
    `curl -X POST '${webhookUrl}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-API-Key: ${apiKey}' \\`,
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
          <p className="text-muted-foreground text-xs [text-wrap:pretty]">
            Copy the curl command, or expand details if you need the raw URL and
            API key.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              {apiKey}
            </code>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Example curl</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-3 text-foreground text-xs">
              <code>{curlExample}</code>
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

export function NotificationDestinationsCard() {
  const { data, isLoading, error } = useNotificationDestinations();
  const createMutation = useCreateNotificationDestination();
  const rotateMutation = useRegenerateNotificationDestinationKey();
  const deleteMutation = useDeleteNotificationDestination();
  const updateMutation = useUpdateNotificationDestination();

  const [name, setName] = useState("");
  const [topicLink, setTopicLink] = useState("");
  const [latestSecret, setLatestSecret] =
    useState<NotificationDestinationWithSecret | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTopicId, setEditingTopicId] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);

  const destinations = data?.destinations ?? [];

  function resetForm() {
    setName("");
    setTopicLink("");
  }

  function handleCreate() {
    setFormError(null);
    const parsedTopic = parseTelegramTopicLink(topicLink);

    if (!parsedTopic) {
      setFormError(
        "Paste a Telegram topic link like https://t.me/c/3734526664/167."
      );
      return;
    }

    createMutation.mutate(
      {
        channel: "telegram",
        name: name.trim() || `Telegram topic ${parsedTopic.topicId}`,
        telegram: {
          chatId: parsedTopic.chatId,
          topicId: parsedTopic.topicId,
        },
      },
      {
        onError: (mutationError) => {
          setFormError(formatError(mutationError));
        },
        onSuccess: (created) => {
          setLatestSecret(created);
          resetForm();
        },
      }
    );
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

    deleteMutation.mutate(destinationId, {
      onError: (mutationError) => {
        setFormError(formatError(mutationError));
      },
      onSuccess: () => {
        if (latestSecret?.destination.id === destinationId) {
          setLatestSecret(null);
        }
      },
    });
  }

  function startEditing(destination: (typeof destinations)[number]) {
    setEditingId(destination.id);
    setEditingTopicId(destination.telegram.topicId?.toString() ?? "");
    setEditingError(null);
  }

  function stopEditing() {
    setEditingId(null);
    setEditingTopicId("");
    setEditingError(null);
  }

  function handleUpdateTopic(destination: (typeof destinations)[number]) {
    setEditingError(null);

    const parsedTopicId = editingTopicId.trim()
      ? Number(editingTopicId.trim())
      : null;

    if (
      parsedTopicId !== null &&
      (!Number.isInteger(parsedTopicId) || parsedTopicId <= 0)
    ) {
      setEditingError("Topic ID must be a positive integer when provided.");
      return;
    }

    updateMutation.mutate(
      {
        destinationId: destination.id,
        request: {
          name: destination.name,
          telegram: {
            chatId: destination.telegram.chatId,
            ...(parsedTopicId === null ? {} : { topicId: parsedTopicId }),
          },
        },
      },
      {
        onError: (mutationError) => {
          setEditingError(formatError(mutationError));
        },
        onSuccess: () => {
          stopEditing();
        },
      }
    );
  }

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-1">
        <p className="font-medium text-foreground text-sm [text-wrap:balance]">
          Notification Destinations
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">Name</span>
          <Input
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">
            Telegram topic link
          </span>
          <Input
            onChange={(event) => setTopicLink(event.target.value)}
            placeholder="https://t.me/c/3734526664/167"
            value={topicLink}
          />
        </label>
      </div>

      <div className="rounded-lg border border-border border-dashed bg-muted/20 p-3 text-muted-foreground text-xs">
        Open the Telegram topic, copy its link, and paste it here. Nakama will
        extract the Chat ID and Topic ID for you automatically.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-w-[10.5rem] justify-center"
          disabled={createMutation.isPending}
          onClick={handleCreate}
        >
          {createMutation.isPending ? <Spinner className="size-4" /> : null}
          Create destination
        </Button>
        <span className="text-muted-foreground text-xs">Channel: Telegram</span>
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
        ) : destinations.length === 0 ? (
          <div className="rounded-lg border border-border border-dashed p-4 text-muted-foreground text-sm">
            No notification destinations yet.
          </div>
        ) : (
          destinations.map((destination) => (
            <div
              className="space-y-3 rounded-3xl border border-border p-4"
              key={destination.id}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground text-sm">
                    {destination.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatTelegramDestinationLabel(destination.telegram)}
                  </p>
                  <code className="block break-all text-muted-foreground text-xs">
                    {destination.webhookPath}
                  </code>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Button
                    className="min-h-10"
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      editingId === destination.id
                        ? stopEditing()
                        : startEditing(destination)
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {editingId === destination.id ? "Cancel" : "Edit topic"}
                  </Button>
                  <Button
                    className="min-h-10"
                    disabled={rotateMutation.isPending}
                    onClick={() => handleRotate(destination.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RefreshIcon aria-hidden className="size-3.5" />
                    Rotate key
                  </Button>
                  <Button
                    className="min-h-10"
                    disabled={deleteMutation.isPending}
                    onClick={() => handleDelete(destination.id)}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    <Delete02Icon aria-hidden className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </div>

              {editingId === destination.id ? (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-muted-foreground text-xs">
                        Telegram topic ID
                      </span>
                      <Input
                        onChange={(event) =>
                          setEditingTopicId(event.target.value)
                        }
                        placeholder="Leave blank to remove topic"
                        value={editingTopicId}
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={updateMutation.isPending}
                        onClick={() => handleUpdateTopic(destination)}
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
                        onClick={stopEditing}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                  {editingError ? (
                    <p className="mt-2 text-destructive text-sm">
                      {editingError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {latestSecret?.destination.id === destination.id ? (
                <LatestSecret latestSecret={latestSecret} />
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
