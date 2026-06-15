import { useCallback, useEffect, useState } from "react";
import { ProviderSettingsCard } from "@/components/settings/ProviderSettingsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserContextSettings } from "@/components/UserContextCard";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAppContext } from "@/context/app-context";
import {
  isThinkingEffort,
  useSaveThinkingSettings,
  useThinkingSettings,
} from "@/hooks/use-thinking-settings";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { formatError } from "@/lib/client";
import { getBrowserTimezone } from "@/lib/timezones";

export function SettingsPage() {
  const { models } = useAppContext();
  const [formError, setFormError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const [timezoneHint, setTimezoneHint] = useState<string | null>(null);
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();
  const { data: savedThinking } = useThinkingSettings();
  const saveThinkingMutation = useSaveThinkingSettings();
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<"low" | "medium" | "high">("medium");
  const [thinkingHint, setThinkingHint] = useState<string | null>(null);

  const isCompatibleProvider =
    models?.providers?.some((provider) => provider.type === "openai_compatible") ?? false;

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  useEffect(() => {
    if (savedThinking) {
      setThinkingEnabled(savedThinking.enabled);
      setThinkingEffort(savedThinking.effort);
    }
  }, [savedThinking]);

  const handleSaveTimezone = useCallback(() => {
    setFormError(null);
    setTimezoneHint(null);

    saveTimezoneMutation.mutate(timezone.trim(), {
      onSuccess: (saved) => {
        setTimezone(saved);
        setTimezoneHint(`Saved · ${saved}`);
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  }, [saveTimezoneMutation, timezone]);

  const handleSaveThinking = useCallback(() => {
    setFormError(null);
    setThinkingHint(null);

    saveThinkingMutation.mutate(
      { enabled: thinkingEnabled, effort: thinkingEffort },
      {
        onSuccess: (saved) => {
          setThinkingEnabled(saved.enabled);
          setThinkingEffort(saved.effort);
          setThinkingHint(
            saved.enabled ? `Saved · ${saved.effort} effort` : "Saved · thinking off",
          );
        },
        onError: (err) => {
          setFormError(formatError(err));
        },
      },
    );
  }, [saveThinkingMutation, thinkingEnabled, thinkingEffort]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Card className="w-full">
        <CardContent className="divide-y divide-border p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Appearance</p>
              <p className="text-xs text-muted-foreground">Color theme</p>
            </div>
            <ThemeToggle />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Timezone</p>
              {timezoneHint ? (
                <p className="text-xs text-emerald-200" role="status">
                  {timezoneHint}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">For scheduled automations</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <TimezoneSelect
                id="timezone"
                className="w-44 min-w-0 sm:w-52"
                value={timezone}
                disabled={saveTimezoneMutation.isPending}
                emptyLabel="Select timezone"
                onValueChange={(nextTimezone) => {
                  if (nextTimezone) {
                    setTimezone(nextTimezone);
                    setTimezoneHint(null);
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={saveTimezoneMutation.isPending || !timezone.trim()}
                onClick={handleSaveTimezone}
              >
                {saveTimezoneMutation.isPending ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>

          <UserContextSettings />
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Extended thinking</p>
              {isCompatibleProvider ? (
                <p className="text-xs text-muted-foreground">
                  Not supported for custom providers
                </p>
              ) : thinkingHint ? (
                <p className="text-xs text-emerald-200" role="status">
                  {thinkingHint}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Show reasoning in chat · uses more tokens
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                id="thinking-enabled"
                checked={thinkingEnabled}
                disabled={isCompatibleProvider || saveThinkingMutation.isPending}
                aria-label="Enable thinking in chat"
                onCheckedChange={(enabled) => {
                  setThinkingEnabled(enabled);
                  setThinkingHint(null);
                }}
              />
              <Select
                value={thinkingEffort}
                disabled={
                  isCompatibleProvider || !thinkingEnabled || saveThinkingMutation.isPending
                }
                onValueChange={(value) => {
                  if (isThinkingEffort(value)) {
                    setThinkingEffort(value);
                    setThinkingHint(null);
                  }
                }}
              >
                <SelectTrigger className="w-29" aria-label="Reasoning depth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                disabled={isCompatibleProvider || saveThinkingMutation.isPending}
                onClick={handleSaveThinking}
              >
                {saveThinkingMutation.isPending ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <TelegramSettingsCard />

      <WhatsAppSettingsCard />

      <ProviderSettingsCard formError={formError} onFormError={setFormError} />

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
