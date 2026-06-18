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
import { Spinner } from "@/components/ui/spinner";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { formatError } from "@/lib/client";
import { getBrowserTimezone } from "@/lib/timezones";

export function SettingsPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const [timezoneHint, setTimezoneHint] = useState<string | null>(null);
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

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
