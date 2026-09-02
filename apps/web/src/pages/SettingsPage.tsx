import { useCallback, useEffect, useState } from "react";
import { DataPortabilityPanel } from "@/components/settings/DataPortabilityPanel";
import { ImageGenerationSettingsCard } from "@/components/settings/ImageGenerationSettingsCard";
import { ProviderSettingsCard } from "@/components/settings/ProviderSettingsCard";
import { TranscriptionSettingsCard } from "@/components/settings/TranscriptionSettingsCard";
import { VisionSettingsCard } from "@/components/settings/VisionSettingsCard";
import { WebPublicUrlSettingsRow } from "@/components/settings/WebPublicUrlSettingsRow";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { formatError } from "@/lib/client";
import { getBrowserTimezone } from "@/lib/timezones";

export function SettingsPage() {
  const { user, activeOrg } = useAuth();
  const { health } = useAppContext();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const isOrgAdmin = activeOrg?.role === "admin";
  const [formError, setFormError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const [timezoneHint, setTimezoneHint] = useState<string | null>(null);
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();
  const version = health?.version?.trim();

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  const handleSaveTimezone = useCallback(() => {
    setFormError(null);
    setTimezoneHint(null);

    saveTimezoneMutation.mutate(timezone.trim(), {
      onError: (err) => {
        setFormError(formatError(err));
      },
      onSuccess: (saved) => {
        setTimezone(saved);
        setTimezoneHint(`Saved · ${saved}`);
      },
    });
  }, [saveTimezoneMutation, timezone]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="font-medium text-foreground text-sm">Appearance</p>
            <ThemeToggle />
          </div>

          {version ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="font-medium text-foreground text-sm">Version</p>
              <p className="font-mono text-muted-foreground text-sm tabular-nums">
                {version}
              </p>
            </div>
          ) : null}

          {isOrgAdmin ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-foreground text-sm">
                    Timezone
                  </p>
                  {timezoneHint ? (
                    <p
                      className="text-emerald-700 text-xs dark:text-emerald-300"
                      role="status"
                    >
                      {timezoneHint}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <TimezoneSelect
                    className="w-44 min-w-0 sm:w-52"
                    disabled={saveTimezoneMutation.isPending}
                    emptyLabel="Select timezone"
                    id="timezone"
                    onValueChange={(nextTimezone) => {
                      if (nextTimezone) {
                        setTimezone(nextTimezone);
                        setTimezoneHint(null);
                      }
                    }}
                    value={timezone}
                  />
                  <Button
                    disabled={
                      saveTimezoneMutation.isPending || !timezone.trim()
                    }
                    onClick={handleSaveTimezone}
                    size="sm"
                    type="button"
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

              <WebPublicUrlSettingsRow />
            </>
          ) : null}
        </CardContent>
      </Card>

      {isOrgAdmin ? (
        <>
          <ProviderSettingsCard
            formError={formError}
            onFormError={setFormError}
          />

          <Card className="w-full shadow-none">
            <CardContent className="divide-y divide-border p-0">
              <VisionSettingsCard />
              <TranscriptionSettingsCard />
              <ImageGenerationSettingsCard />
            </CardContent>
          </Card>

          {formError ? (
            <p className="text-destructive text-sm" role="alert">
              {formError}
            </p>
          ) : null}
        </>
      ) : null}

      {isPlatformAdmin ? (
        <Card className="w-full overflow-hidden shadow-none">
          <CardContent className="p-0">
            <DataPortabilityPanel />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
