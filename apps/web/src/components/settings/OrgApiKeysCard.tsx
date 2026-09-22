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
import { useState } from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

type SecretState = { key: ApiKeySummary; secret: string } | null;

export function OrgApiKeysCard() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();
  const [name, setName] = useState("Lovable app");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [expiresAt, setExpiresAt] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [secretState, setSecretState] = useState<SecretState>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    enabled: Boolean(orgId) && activeOrg?.role === "admin",
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

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

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

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-normal text-muted-foreground/55 text-sm">
          Backend API keys
        </h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Create keys for server-side apps such as Lovable. The secret is shown
          only once.
        </p>
      </div>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">Create a backend key</p>
              <p className="text-muted-foreground text-xs">
                Use this key from a server-side app or integration.
              </p>
            </div>
            <Dialog
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (open) {
                  setError(null);
                  createMutation.reset();
                }
              }}
              open={createOpen}
            >
              <DialogTrigger asChild>
                <Button disabled={busy} type="button">
                  Create API key
                </Button>
              </DialogTrigger>
              <DialogContent className="gap-6 p-6 sm:max-w-md">
                <DialogHeader className="gap-2">
                  <DialogTitle>Create backend API key</DialogTitle>
                  <DialogDescription>
                    Use this key only from your backend. The secret will be
                    shown once after creation.
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
                          variant={
                            environment === value ? "default" : "outline"
                          }
                        >
                          {value === "live" ? "Live" : "Test"}
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">Expires on</span>
                    <Input
                      disabled={busy}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(event) => setExpiresAt(event.target.value)}
                      type="date"
                      value={expiresAt}
                    />
                    <span className="block text-muted-foreground text-xs">
                      Optional. Leave blank for a key without an expiry.
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
          </div>

          {secretState ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
              <p className="font-medium text-sm">Save this secret now</p>
              <p className="text-muted-foreground text-xs">
                It will not be shown again. Keep it in your backend secret
                store.
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
          ) : null}

          {keysQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading keys…</p>
          ) : null}
          {keysQuery.error ? (
            <p className="text-destructive text-sm" role="alert">
              {formatError(keysQuery.error)}
            </p>
          ) : null}
          <div className="divide-y rounded-md border">
            {(keysQuery.data?.keys ?? []).map((key) => (
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
            {!keysQuery.isLoading &&
            (keysQuery.data?.keys ?? []).length === 0 ? (
              <p className="p-3 text-muted-foreground text-sm">
                No backend keys yet.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
