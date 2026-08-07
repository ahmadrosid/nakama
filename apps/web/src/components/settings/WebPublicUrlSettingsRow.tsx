import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useSaveWebPublicUrl, useWebPublicUrlSettings } from "@/hooks/use-web-public-url";
import { formatError } from "@/lib/client";

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
      onSuccess: (saved) => {
        setValue(saved.webPublicUrl);
        setSavedHint("Saved");
      },
      onError: (error) => {
        setFormError(formatError(error));
      },
    });
  };

  const handleUseCurrent = () => {
    if (typeof window !== "undefined" && window.location?.origin) {
      setValue(window.location.origin);
      setSavedHint(null);
      setFormError(null);
      saveMutation.reset();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Public web URL</p>
          <p className="text-xs text-muted-foreground">Loading…</p>
        </div>
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <label htmlFor="web-public-url" className="text-balance text-sm font-medium text-foreground">
            Public web URL
          </label>
          <p className="text-pretty text-xs text-muted-foreground">For OAuth callbacks</p>
        </div>
        {savedHint ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">
            {savedHint}
          </p>
        ) : null}
      </div>

      {data?.envOverride ? (
        <p className="text-pretty text-xs text-amber-800 dark:text-amber-200">
          Server env overrides this with {data.envOverride}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="web-public-url"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSavedHint(null);
            setFormError(null);
            saveMutation.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            }
          }}
          placeholder="https://nakama.example.com"
          className="min-w-[12rem] flex-1"
          disabled={saveMutation.isPending}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? "web-public-url-error" : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUseCurrent}
          disabled={saveMutation.isPending}
        >
          Use current
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending || !value.trim()}
          onClick={handleSave}
        >
          {saveMutation.isPending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>

      {formError ? (
        <p id="web-public-url-error" className="text-pretty text-xs text-destructive" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
