import type { CodingHarnessSettingsResponse } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { cn } from "@nakama/ui/utils";
import { CheckmarkCircle01Icon, Copy01Icon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { CodingAgentLogo } from "@/components/coding-agent-logos";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable outside a secure context.
    }
  }

  const iconTransition =
    "absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]";

  return (
    <Button
      aria-label={copied ? `Copied ${command}` : `Copy ${command}`}
      className="relative size-8 text-muted-foreground after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 hover:text-foreground"
      onClick={() => void handleCopy()}
      size="icon"
      type="button"
      variant="ghost"
    >
      <span aria-hidden className="relative size-3.5 shrink-0">
        <Copy01Icon
          className={cn(
            iconTransition,
            copied
              ? "scale-[0.25] opacity-0 blur-[4px]"
              : "scale-100 opacity-100 blur-0"
          )}
          strokeWidth={1.5}
        />
        <CheckmarkCircle01Icon
          className={cn(
            iconTransition,
            "text-emerald-600 dark:text-emerald-400",
            copied
              ? "scale-100 opacity-100 blur-0"
              : "scale-[0.25] opacity-0 blur-[4px]"
          )}
          strokeWidth={1.5}
        />
      </span>
    </Button>
  );
}

function AgentRow({
  command,
  name,
  method,
}: {
  command: string;
  name: string;
  method: "command" | "host" | "nakama";
}) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5 transition-[background-color] duration-150 ease-out hover:bg-muted/40">
      <CodingAgentLogo command={command} name={name} />
      <span className="min-w-0 truncate font-medium text-foreground text-sm sm:shrink-0">
        {name}
      </span>
      {method === "command" ? (
        <>
          <code className="min-w-0 flex-1 truncate text-right font-mono text-muted-foreground text-xs">
            {command}
          </code>
          <CopyCommandButton command={command} />
        </>
      ) : (
        <span className="min-w-0 flex-1 text-right text-muted-foreground text-xs">
          {method === "nakama" ? "Nakama keys" : "Always host login"}
        </span>
      )}
    </li>
  );
}

export function CodingAgentsSettingsCard() {
  const { user } = useAuth();
  const canManageSettings = user?.isPlatformAdmin === true;
  const [settings, setSettings] =
    useState<CodingHarnessSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void client
      .getCodingHarnessSettings()
      .then((response) => {
        if (!cancelled) {
          setSettings(response);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(formatError(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(providerPassthroughEnabled: boolean) {
    setSaving(true);
    setError(null);

    try {
      const response = await client.setCodingHarnessSettings(
        providerPassthroughEnabled
      );
      setSettings(response);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (!(settings || error)) {
    return (
      <div className="flex min-h-32 items-center justify-center text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }

  const passthrough = settings?.providerPassthroughEnabled !== false;
  const loginCommands = settings?.loginCommands ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-balance font-semibold text-foreground text-xl leading-tight">
        Coding agents
      </h2>

      <div className="flex items-center justify-between gap-4 rounded-md border border-primary/40 px-3.5 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Use Nakama keys</p>
          <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
            Give Codex, Claude Code, OpenCode, and pi the keys already set up
            here. Cursor always uses the host login.
          </p>
        </div>
        <Switch
          aria-label="Use Nakama keys"
          checked={passthrough}
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2"
          disabled={!canManageSettings || saving || !settings}
          onCheckedChange={toggle}
        />
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <section className="space-y-2">
        <h3 className="px-0.5 font-medium text-2xs text-muted-foreground uppercase tracking-[0.12em]">
          {passthrough ? "What each agent uses" : "Log in on this host"}
        </h3>
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {loginCommands.map((item) => (
            <AgentRow
              command={item.command}
              key={item.command}
              method={passthrough ? "nakama" : "command"}
              name={item.name}
            />
          ))}
          <AgentRow command="agent" method="host" name="Cursor Agent" />
        </ul>
      </section>
    </div>
  );
}
