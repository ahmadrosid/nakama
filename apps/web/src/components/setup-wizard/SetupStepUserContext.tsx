import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { useEffect, useState } from "react";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { UserContextForm } from "@/components/UserContextForm";
import { useAuth } from "@/context/use-auth";
import {
  useUserContextQuery,
  useWriteUserContextMutation,
} from "@/hooks/use-resource-mutations";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import {
  clearUserContextDraft,
  useUserContextEditor,
  writeUserContextDraft,
} from "@/hooks/use-user-context-editor";
import { formatError } from "@/lib/client";
import { getBrowserTimezone } from "@/lib/timezones";

interface SetupStepUserContextProps {
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function SetupStepUserContext(props: SetupStepUserContextProps) {
  const { activeOrg } = useAuth();
  return <SetupUserContextSession key={activeOrg?.id} {...props} />;
}

function SetupUserContextSession({
  onNext,
  onSkip,
  onBack,
}: SetupStepUserContextProps) {
  const { activeOrg, user } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();

  const {
    data: status,
    isLoading,
    error: loadError,
  } = useUserContextQuery({
    includeContent: true,
    orgId,
  });
  const writeMutation = useWriteUserContextMutation();
  const { content, savedContent, setContent, setSavedContent } =
    useUserContextEditor({
      defaultName: user?.name,
      orgId,
      status,
    });

  const [formError, setFormError] = useState<string | null>(null);
  const busy = writeMutation.isPending;

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  function handleSkip() {
    if (content !== savedContent) {
      writeUserContextDraft(orgId, content);
    }
    onSkip();
  }

  async function handleNext() {
    if (busy || isLoading || loadError) {
      return;
    }
    setFormError(null);

    if (content === savedContent) {
      clearUserContextDraft(orgId);
      onNext();
      return;
    }

    try {
      await writeMutation.mutateAsync(content);
      setSavedContent(content);
      clearUserContextDraft(orgId);
      onNext();
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleNext();
      }}
    >
      <div className="rounded-md border border-border bg-card px-4 py-4">
        <h2 className="mb-4 font-semibold text-base text-foreground">
          About you
        </h2>

        {isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <UserContextForm
            disabled={busy}
            idPrefix="setup-user-context"
            onChange={(next) => {
              setContent(next);
              if (formError) {
                setFormError(null);
              }
            }}
            value={content}
          />
        )}
      </div>

      <div className="rounded-md border border-border bg-card px-4 py-3">
        <div className="space-y-2">
          <label
            className="font-medium text-foreground text-sm"
            htmlFor="setup-timezone"
          >
            Timezone
          </label>
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

      {formError || loadError ? (
        <p className="text-destructive text-sm" role="alert">
          {formError ?? formatError(loadError)}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          disabled={busy}
          onClick={onBack}
          size="sm"
          type="button"
          variant="ghost"
        >
          Back
        </Button>

        <div className="flex items-center gap-3">
          <button
            className="text-muted-foreground text-sm underline underline-offset-4 transition-colors hover:text-foreground"
            disabled={busy}
            onClick={handleSkip}
            type="button"
          >
            Set up later
          </button>

          <Button
            disabled={busy || isLoading || !!loadError}
            size="sm"
            type="submit"
          >
            {busy ? (
              <>
                <Spinner className="mr-2" />
                Saving…
              </>
            ) : (
              "Finish"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
