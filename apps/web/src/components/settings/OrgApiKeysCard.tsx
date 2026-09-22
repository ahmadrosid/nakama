import type { ApiKeySummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy01Icon } from "hugeicons-react";
import { useState } from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

type SecretState = { key: ApiKeySummary; secret: string } | null;

const INTEGRATION_PROMPT = `Integrate this existing app with Nakama as the AI agent backend.

Read these docs before coding:
- https://ahmadrosid.github.io/nakama/lovable.md
- https://ahmadrosid.github.io/nakama/llms.txt
- Treat the Lovable guide as the source of truth for Nakama endpoints, request bodies, and response formats.

Requirements:
- Inspect the existing app and preserve its current UI, authentication, and data model.
- Keep NAKAMA_API_KEY server-side. Never expose it in browser code, HTML, logs, or URLs.
- Read only NAKAMA_URL and NAKAMA_API_KEY from server-side secrets.
- Add a server-side chat route that connects the existing chat UI to Nakama.
- Create one Nakama web session per browser conversation and reuse its sessionId.
- Pass the authenticated app user's stable ID as appUserId when creating the session.
- Omit profileId so Nakama uses the organization's default profile.
- Send X-Nakama-App-User-Id with every request for that session.
- Return the assistant reply to the existing UI. Support streaming SSE with chunk, done, and error events if streaming is enabled.
- Keep each app user's Nakama session and memory isolated by their stable authenticated user ID.
- Do not call Nakama directly from the browser.`;

function useOrgApiKeys(orgId: string) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [secretState, setSecretState] = useState<SecretState>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [promptCopyHint, setPromptCopyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listApiKeys(orgId),
    queryKey: queryKeys.orgApiKeys(orgId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      client.createApiKey(orgId, {
        name: name.trim(),
      }),
    onError: (cause) => setError(formatError(cause)),
    onSuccess: (result) => {
      setError(null);
      setSecretState(result);
      setCreateOpen(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgApiKeys(orgId),
      });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (keyId: string) => client.rotateApiKey(orgId, keyId),
    onError: (cause) => setError(formatError(cause)),
    onSuccess: (result) => {
      setError(null);
      setSecretState(result);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgApiKeys(orgId),
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => client.revokeApiKey(orgId, keyId),
    onError: (cause) => setError(formatError(cause)),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgApiKeys(orgId),
      });
    },
  });

  const busy =
    createMutation.isPending ||
    rotateMutation.isPending ||
    revokeMutation.isPending;

  async function copySecret() {
    if (!secretState) {
      return;
    }
    try {
      await navigator.clipboard.writeText(secretState.secret);
      setCopyHint("Copied to clipboard.");
    } catch {
      setCopyHint("Copy failed — select the key manually.");
    }
  }

  async function copyIntegrationPrompt() {
    try {
      await navigator.clipboard.writeText(INTEGRATION_PROMPT);
      setPromptCopyHint("Prompt copied.");
    } catch {
      setPromptCopyHint("Copy failed — use the documentation link instead.");
    }
  }

  function createKey(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSecretState(null);
    setCopyHint(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    createMutation.mutate();
  }

  return {
    busy,
    copyHint,
    copyIntegrationPrompt,
    copySecret,
    createKey,
    createMutation,
    createOpen,
    error,
    keysQuery,
    name,
    promptCopyHint,
    revokeMutation,
    rotateMutation,
    secretState,
    setCreateOpen,
    setName,
  };
}

type OrgApiKeysController = ReturnType<typeof useOrgApiKeys>;

function CreateApiKeyDialog({
  controller,
}: {
  controller: OrgApiKeysController;
}) {
  const {
    busy,
    createKey,
    createMutation,
    createOpen,
    error,
    name,
    setCreateOpen,
    setName,
  } = controller;

  return (
    <Dialog
      onOpenChange={(open) => {
        setCreateOpen(open);
        if (open) {
          createMutation.reset();
        }
      }}
      open={createOpen}
    >
      <DialogTrigger
        render={
          <Button disabled={busy} type="button">
            Create API key
          </Button>
        }
      />
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-2">
          <DialogTitle>Create backend API key</DialogTitle>
          <DialogDescription>
            Backend use only. Secret shown once.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={createKey}>
          <label className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-foreground/90">Key name</span>
            <Input
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={busy}
              onClick={() => setCreateOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {createMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                "Create key"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretBanner({ controller }: { controller: OrgApiKeysController }) {
  const { copyHint, copySecret, secretState } = controller;
  if (!secretState) {
    return null;
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
      <p className="font-medium text-sm">Save this secret now</p>
      <p className="text-muted-foreground text-xs">
        Shown once. Store it in your backend secret manager.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={secretState.secret} />
        <Button
          onClick={() => void copySecret()}
          type="button"
          variant="outline"
        >
          Copy
        </Button>
      </div>
      {copyHint ? (
        <p className="text-muted-foreground text-xs">{copyHint}</p>
      ) : null}
    </div>
  );
}

function ApiKeysList({ controller }: { controller: OrgApiKeysController }) {
  const { busy, keysQuery, revokeMutation, rotateMutation } = controller;
  if (keysQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading keys…</p>;
  }
  if (keysQuery.error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {formatError(keysQuery.error)}
      </p>
    );
  }
  const keys = keysQuery.data?.keys ?? [];
  return (
    <div className="divide-y rounded-md border">
      {keys.map((key) => (
        <div
          className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
          key={key.id}
        >
          <div className="min-w-0">
            <p className="font-medium">{key.name}</p>
            <p className="text-muted-foreground text-xs">
              {key.keyPrefix} · created{" "}
              {new Date(key.createdAt).toLocaleDateString()}
              {key.revokedAt ? " · revoked" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={busy || Boolean(key.revokedAt)}
              onClick={() => rotateMutation.mutate(key.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Rotate
            </Button>
            <Button
              disabled={busy || Boolean(key.revokedAt)}
              onClick={() => revokeMutation.mutate(key.id)}
              size="sm"
              type="button"
              variant="destructive"
            >
              Revoke
            </Button>
          </div>
        </div>
      ))}
      {keys.length === 0 ? (
        <p className="p-3 text-muted-foreground text-sm">
          No backend keys yet.
        </p>
      ) : null}
    </div>
  );
}

function IntegrationPrompt({
  controller,
}: {
  controller: OrgApiKeysController;
}) {
  const { copyIntegrationPrompt, promptCopyHint } = controller;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        onClick={() => void copyIntegrationPrompt()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Copy01Icon aria-hidden className="size-3.5" />
        Copy prompt
      </Button>
      {promptCopyHint ? (
        <span className="text-muted-foreground">{promptCopyHint}</span>
      ) : null}
    </div>
  );
}

export function OrgApiKeysCard() {
  const { activeOrg } = useAuth();
  const controller = useOrgApiKeys(
    activeOrg?.role === "admin" ? activeOrg.id : ""
  );
  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-normal text-muted-foreground/55 text-sm">
          Backend API keys
        </h2>
      </div>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">Create a backend key</p>
            </div>
            <CreateApiKeyDialog controller={controller} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <a
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              href="/docs"
              rel="noreferrer"
              target="_blank"
            >
              REST API reference ↗
            </a>
            <a
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              href="https://ahmadrosid.github.io/nakama/lovable"
              rel="noreferrer"
              target="_blank"
            >
              Lovable guide ↗
            </a>
            <IntegrationPrompt controller={controller} />
          </div>
          <SecretBanner controller={controller} />
          <ApiKeysList controller={controller} />
        </CardContent>
      </Card>
    </section>
  );
}
