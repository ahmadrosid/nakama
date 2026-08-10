import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  useSaveWebPublicUrl,
  useWebPublicUrlSettings,
} from "@/hooks/use-web-public-url";
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
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: (saved) => {
        setValue(saved.webPublicUrl);
        setSavedHint("Saved");
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
          <p className="font-medium text-foreground text-sm">Public web URL</p>
          <p className="text-muted-foreground text-xs">Loading…</p>
        </div>
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <label
            className="text-balance font-medium text-foreground text-sm"
            htmlFor="web-public-url"
          >
            Public web URL
          </label>
          <p className="text-pretty text-muted-foreground text-xs">
            For OAuth callbacks
          </p>
        </div>
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
          disabled={saveMutation.isPending}
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
              handleSave();
            }
          }}
          placeholder="https://nakama.example.com"
          value={value}
        />
        <Button
          disabled={saveMutation.isPending}
          onClick={handleUseCurrent}
          size="sm"
          type="button"
          variant="outline"
        >
          Use current
        </Button>
        <Button
          disabled={saveMutation.isPending || !value.trim()}
          onClick={handleSave}
          size="sm"
          type="button"
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
