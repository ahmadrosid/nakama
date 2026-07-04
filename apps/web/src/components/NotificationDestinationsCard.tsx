import { useState } from "react";
import type { NotificationDestinationWithSecret } from "@tinyclaw/core/contract";
import { CheckIcon, CopyIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const webhookUrl = buildNotificationWebhookUrl(origin, latestSecret.destination.webhookPath);
  const curlExample = [
    `curl -X POST '${webhookUrl}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-API-Key: ${apiKey}' \\`,
    `  -d '{`,
    `    "title": "New notification",`,
    `    "body": "Hello from TinyClaw",`,
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
          <p className="text-sm font-medium text-foreground">Latest webhook credentials ready</p>
          <p className="text-xs text-muted-foreground">
            Copy the curl command, or expand details if you need the raw URL and API key.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void copyCurlExample()}>
            {copiedCurl ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            {copiedCurl ? "Copied" : "Copy curl"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyApiKey()}>
            {copiedApiKey ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            {copiedApiKey ? "Copied key" : "Copy API key"}
          </Button>
        </div>
      </div>

      <details className="mt-3 group">
        <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
          Show webhook details
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Webhook URL</p>
            <code className="block break-all text-xs text-foreground">{webhookUrl}</code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">API key</p>
            <code className="block break-all text-xs text-foreground">{apiKey}</code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Example curl</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs text-foreground">
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
  const [latestSecret, setLatestSecret] = useState<NotificationDestinationWithSecret | null>(
    null,
  );
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
      setFormError("Paste a Telegram topic link like https://t.me/c/3734526664/167.");
      return;
    }

    createMutation.mutate(
      {
        name: name.trim() || `Telegram topic ${parsedTopic.topicId}`,
        channel: "telegram",
        telegram: {
          chatId: parsedTopic.chatId,
          topicId: parsedTopic.topicId,
        },
      },
      {
        onSuccess: (created) => {
          setLatestSecret(created);
          resetForm();
        },
        onError: (mutationError) => {
          setFormError(formatError(mutationError));
        },
      },
    );
  }

  async function handleRotate(destinationId: string) {
    setFormError(null);

    rotateMutation.mutate(destinationId, {
      onSuccess: (rotated) => {
        setLatestSecret(rotated);
      },
      onError: (mutationError) => {
        setFormError(formatError(mutationError));
      },
    });
  }

  async function handleDelete(destinationId: string) {
    setFormError(null);

    deleteMutation.mutate(destinationId, {
      onSuccess: () => {
        if (latestSecret?.destination.id === destinationId) {
          setLatestSecret(null);
        }
      },
      onError: (mutationError) => {
        setFormError(formatError(mutationError));
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

    const parsedTopicId = editingTopicId.trim() ? Number(editingTopicId.trim()) : null;

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
            ...(parsedTopicId !== null ? { topicId: parsedTopicId } : {}),
          },
        },
      },
      {
        onSuccess: () => {
          stopEditing();
        },
        onError: (mutationError) => {
          setEditingError(formatError(mutationError));
        },
      },
    );
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="space-y-4 py-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Notification Destinations</p>
          <p className="text-xs text-muted-foreground">
            Create a Telegram destination, then use the webhook URL and API key from TinyClaw
            to send simple notifications.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Telegram topic link</span>
            <Input
              value={topicLink}
              onChange={(event) => setTopicLink(event.target.value)}
              placeholder="https://t.me/c/3734526664/167"
            />
          </label>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          Open the Telegram topic, copy its link, and paste it here. TinyClaw will extract the
          Chat ID and Topic ID for you automatically.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? <Spinner className="size-4" /> : null}
            Create destination
          </Button>
          <span className="text-xs text-muted-foreground">Channel: Telegram</span>
        </div>

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        {error ? <p className="text-sm text-destructive">{formatError(error)}</p> : null}

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
              <Spinner className="size-5" />
            </div>
          ) : destinations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No notification destinations yet.
            </div>
          ) : (
            destinations.map((destination) => (
              <div
                key={destination.id}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground">{destination.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTelegramDestinationLabel(destination.telegram)}
                    </p>
                    <code className="block break-all text-xs text-muted-foreground">
                      {destination.webhookPath}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        editingId === destination.id
                          ? stopEditing()
                          : startEditing(destination)
                      }
                      disabled={updateMutation.isPending}
                    >
                      {editingId === destination.id ? "Cancel" : "Edit topic"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRotate(destination.id)}
                      disabled={rotateMutation.isPending}
                    >
                      <RefreshCwIcon className="size-4" />
                      Rotate key
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(destination.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2Icon className="size-4" />
                      Delete
                    </Button>
                  </div>
                </div>

                {editingId === destination.id ? (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end">
                      <label className="flex-1 space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Telegram topic ID
                        </span>
                        <Input
                          value={editingTopicId}
                          onChange={(event) => setEditingTopicId(event.target.value)}
                          placeholder="Leave blank to remove topic"
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleUpdateTopic(destination)}
                          disabled={updateMutation.isPending}
                        >
                          {updateMutation.isPending ? <Spinner className="size-4" /> : null}
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={stopEditing}
                          disabled={updateMutation.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                    {editingError ? (
                      <p className="mt-2 text-sm text-destructive">{editingError}</p>
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
      </CardContent>
    </Card>
  );
}
