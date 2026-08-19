import type { CodingHarnessSettingsResponse } from "@nakama/core/contract";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { client, formatError } from "@/lib/client";

export function CodingAgentsSettingsCard() {
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="font-medium text-sm">Use Nakama provider</p>
        <Switch
          aria-label="Use Nakama provider"
          checked={passthrough}
          className="mt-0.5"
          disabled={saving || !settings}
          onCheckedChange={toggle}
        />
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      {passthrough ? null : (
        <ul className="space-y-1 font-mono text-muted-foreground text-xs">
          {settings?.loginCommands.map((item) => (
            <li key={item.command}>
              {item.name}: {item.command}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
