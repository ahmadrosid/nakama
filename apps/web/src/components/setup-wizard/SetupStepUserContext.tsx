import { useEffect, useState } from "react";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import {
  clearUserContextDraft,
  USER_CONTEXT_SECTIONS,
  useUserContextEditor,
  writeUserContextDraft,
} from "@/components/UserContextForm";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import {
  useUserContextQuery,
  useWriteUserContextMutation,
} from "@/hooks/use-resource-mutations";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { formatError } from "@/lib/client";
import { getBrowserTimezone } from "@/lib/timezones";
import { cn } from "@/lib/utils";

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
  const { activeOrg, user } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();

  const { data: status, isLoading } = useUserContextQuery({
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
  const [sectionIndex, setSectionIndex] = useState(0);

  const section = USER_CONTEXT_SECTIONS[sectionIndex];
  const isLast = sectionIndex === USER_CONTEXT_SECTIONS.length - 1;
  const busy = writeMutation.isPending;

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  function handleBack() {
    setFormError(null);
    if (sectionIndex === 0) {
      onBack();
      return;
    }
    setSectionIndex((index) => index - 1);
  }

  function handleSkip() {
    if (content !== savedContent) {
      writeUserContextDraft(orgId, content);
    }
    onSkip();
  }

  async function handleNext() {
    setFormError(null);

    if (!isLast) {
      setSectionIndex((index) => index + 1);
      return;
    }

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
        <div className="mb-4 space-y-2">
          <ol
            aria-label="Personalisation progress"
            className="flex items-center gap-1.5"
          >
            {USER_CONTEXT_SECTIONS.map((candidate, index) => (
              <li
                aria-current={index === sectionIndex ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  index === sectionIndex
                    ? "w-6 bg-primary"
                    : index < sectionIndex
                      ? "w-1.5 bg-primary/60"
                      : "w-1.5 bg-border"
                )}
                key={candidate.id}
              >
                <span className="sr-only">{candidate.title}</span>
              </li>
            ))}
          </ol>
          <div className="space-y-0.5">
            <h2 className="font-semibold text-base text-foreground">
              {section.title}
            </h2>
            <p className="text-muted-foreground text-sm">{section.subtitle}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <section.Component
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

      {isLast ? (
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
      ) : null}

      {formError ? (
        <p className="text-destructive text-sm" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          disabled={busy}
          onClick={handleBack}
          size="sm"
          type="button"
          variant="ghost"
        >
          Back
        </Button>

        <div className="flex items-center gap-3">
          <button
            className="text-muted-foreground text-sm underline underline-offset-4 transition-colors hover:text-foreground"
            onClick={handleSkip}
            type="button"
          >
            Set up later
          </button>

          <Button disabled={busy || isLoading} size="sm" type="submit">
            {busy ? (
              <>
                <Spinner className="mr-2" />
                Saving…
              </>
            ) : isLast ? (
              "Finish"
            ) : (
              "Next"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
