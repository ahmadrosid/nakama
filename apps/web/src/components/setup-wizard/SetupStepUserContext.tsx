import { useEffect, useState } from "react";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { UserContextSettings } from "@/components/UserContextCard";
import { Button } from "@/components/ui/button";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { getBrowserTimezone } from "@/lib/timezones";

interface SetupStepUserContextProps {
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function SetupStepUserContext({
  onNext,
  onSkip,
  onBack,
}: SetupStepUserContextProps) {
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card">
        <UserContextSettings autoInit={true} />
      </div>

      <div className="rounded-md border border-border bg-card px-4 py-3">
        <div className="space-y-2">
          <div className="space-y-0.5">
            <p className="font-medium text-foreground text-sm">Timezone</p>
            <p className="text-muted-foreground text-xs">
              For scheduled automations and local time awareness
            </p>
          </div>
          <TimezoneSelect
            disabled={saveTimezoneMutation.isPending}
            emptyLabel="Select timezone"
            id="setup-timezone"
            onValueChange={(nextTimezone) => {
              if (nextTimezone) {
                setTimezone(nextTimezone);
                saveTimezoneMutation.mutate(nextTimezone);
              }
            }}
            value={timezone}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button onClick={onBack} size="sm" type="button" variant="ghost">
          Back
        </Button>

        <div className="flex items-center gap-3">
          <button
            className="text-muted-foreground text-sm underline underline-offset-4 transition-colors hover:text-foreground"
            onClick={onSkip}
            type="button"
          >
            Set up later
          </button>

          <Button onClick={onNext} size="sm" type="button">
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
