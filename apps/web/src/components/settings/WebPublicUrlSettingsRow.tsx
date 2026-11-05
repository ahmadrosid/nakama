import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { useEffect, useState } from "react";
import {
  useSaveWebPublicUrl,
  useWebPublicUrlSettings,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

function WebPublicUrlActions({
  currentOrigin,
  isDirty,
  onSave,
  onUseCurrent,
  pending,
  value,
}: {
  currentOrigin: string;
  isDirty: boolean;
  onSave: () => void;
  onUseCurrent: () => void;
  pending: boolean;
  value: string;
}) {
  return (
    <>
      {currentOrigin && value.trim() !== currentOrigin ? (
        <Button
          disabled={pending}
          onClick={onUseCurrent}
          type="button"
          variant="outline"
        >
          Use {currentOrigin}
        </Button>
      ) : null}
      {isDirty || pending ? (
        <Button
          disabled={pending || !value.trim()}
          onClick={onSave}
          size="sm"
          type="button"
        >
          {pending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      ) : null}
    </>
  );
}

export function WebPublicUrlSettingsRow() {
  const { data, isLoading } = useWebPublicUrlSettings();
  const saveMutation = useSaveWebPublicUrl();
  const [value, setValue] = useState("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.webPublicUrl) {
      setValue(data.webPublicUrl);
    }
  }, [data?.webPublicUrl]);

  useEffect(() => {
    if (!savedHint) {
      return;
    }

    const timeout = window.setTimeout(() => setSavedHint(null), 2500);

    return () => window.clearTimeout(timeout);
  }, [savedHint]);

  const handleSave = () => {
    setFormError(null);
    setSavedHint(null);
    saveMutation.reset();

    const trimmed = value.trim();

    if (!trimmed) {
      setFormError("Public web URL is required.");

      return;
    }

    saveMutation.mutate(trimmed, {
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: (saved) => {
        setValue(saved.webPublicUrl ?? trimmed);
        setSavedHint("Saved");
        // Save unmounts now that nothing changed; keep focus in the row.
        document.getElementById("web-public-url")?.focus();
      },
    });
  };

  const currentOrigin =
    typeof window === "undefined" ? "" : (window.location?.origin ?? "");

  const savedValue = data?.webPublicUrl ?? "";
  const isDirty = value.trim() !== savedValue;

  const handleUseCurrent = () => {
    setValue(currentOrigin);
    setSavedHint(null);
    setFormError(null);
    saveMutation.reset();
    // This button hides once the field matches; keep focus in the row.
    document.getElementById("web-public-url")?.focus();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="space-y-0.5">
          <p className="text-foreground text-sm">Public web URL</p>
          <p className="text-muted-foreground text-xs">Loading…</p>
        </div>
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label
          className="min-w-0 text-balance font-medium text-foreground text-sm"
          htmlFor="web-public-url"
        >
          Public web URL
        </label>
        {savedHint ? (
          <p
            className="text-emerald-700 text-xs dark:text-emerald-300"
            role="status"
          >
            {savedHint}
          </p>
        ) : null}
      </div>

      {data?.envOverride ? (
        <p className="text-pretty text-amber-800 text-xs dark:text-amber-200">
          Server env overrides this with {data.envOverride}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-describedby={formError ? "web-public-url-error" : undefined}
          aria-invalid={formError ? true : undefined}
          className="min-w-[12rem] flex-1"
          id="web-public-url"
          onChange={(event) => {
            setValue(event.target.value);
            setSavedHint(null);
            setFormError(null);
            saveMutation.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();

              if (isDirty && !saveMutation.isPending) {
                handleSave();
              }
            }
          }}
          placeholder="https://nakama.example.com"
          readOnly={saveMutation.isPending}
          value={value}
        />
        <WebPublicUrlActions
          currentOrigin={currentOrigin}
          isDirty={isDirty}
          onSave={handleSave}
          onUseCurrent={handleUseCurrent}
          pending={saveMutation.isPending}
          value={value}
        />
      </div>

      {formError ? (
        <p
          className="text-pretty text-destructive text-xs"
          id="web-public-url-error"
          role="alert"
        >
          {formError}
        </p>
      ) : null}
    </div>
  );
}
