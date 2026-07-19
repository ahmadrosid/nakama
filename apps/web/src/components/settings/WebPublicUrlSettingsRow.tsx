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
        setSavedHint(`Saved · ${saved.webPublicUrl}`);
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
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">Public web URL</p>
        <p className="text-xs text-muted-foreground">
          Base URL for OAuth callbacks. Saved to ~/.nakama/config.ini.
        </p>
        {data?.envOverride ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Server env overrides this with {data.envOverride}.
          </p>
        ) : null}
        {savedHint ? (
          <p className="text-xs text-emerald-200" role="status">
            {savedHint}
          </p>
        ) : null}
        {formError ? (
          <p className="text-xs text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
      </div>

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
          placeholder="https://nakama.example.com"
          className="min-w-0 flex-1"
          disabled={saveMutation.isPending}
        />
        <Button type="button" variant="outline" size="sm" onClick={handleUseCurrent}>
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
    </div>
  );
}
