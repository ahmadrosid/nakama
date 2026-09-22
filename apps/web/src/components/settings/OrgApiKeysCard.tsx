import type { ApiKeySummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Calendar } from "@nakama/ui/calendar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { Spinner } from "@nakama/ui/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

type SecretState = { key: ApiKeySummary; secret: string } | null;

function useOrgApiKeys(orgId: string) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Lovable app");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [expiresAt, setExpiresAt] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [secretState, setSecretState] = useState<SecretState>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listApiKeys(orgId),
    queryKey: queryKeys.orgApiKeys(orgId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      client.createApiKey(orgId, {
        environment,
        expiresAt: expiresAt
          ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString()
          : null,
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
    copySecret,
    createKey,
    createMutation,
    createOpen,
    environment,
    error,
    expiresAt,
    keysQuery,
    name,
    revokeMutation,
    rotateMutation,
    secretState,
    setCreateOpen,
    setEnvironment,
    setExpiresAt,
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
    environment,
    error,
    expiresAt,
    name,
    setCreateOpen,
    setEnvironment,
    setExpiresAt,
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
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Key name</span>
            <Input
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <fieldset className="space-y-1.5">
            <legend className="font-medium text-sm">Environment</legend>
            <div className="flex gap-2">
              {(["live", "test"] as const).map((value) => (
                <Button
                  className="flex-1"
                  key={value}
                  onClick={() => setEnvironment(value)}
                  type="button"
                  variant={environment === value ? "default" : "outline"}
                >
                  {value === "live" ? "Live" : "Test"}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Expires on</span>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    className="w-full justify-start text-left font-normal"
                    disabled={busy}
                    type="button"
                    variant="outline"
                  />
                }
              >
                {expiresAt ? format(parseISO(expiresAt), "PPP") : "Pick a date"}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  disabled={{ before: new Date() }}
                  mode="single"
                  onSelect={(date) =>
                    setExpiresAt(date ? format(date, "yyyy-MM-dd") : "")
                  }
                  selected={expiresAt ? parseISO(expiresAt) : undefined}
                />
              </PopoverContent>
            </Popover>
            <span className="block text-muted-foreground text-xs">
              Optional
            </span>
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
              {key.keyPrefix} · {key.environment} · created{" "}
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
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
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
          </div>
          <SecretBanner controller={controller} />
          <ApiKeysList controller={controller} />
        </CardContent>
      </Card>
    </section>
  );
}
