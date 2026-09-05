import type { WebSearchProvider } from "@nakama/core/contract";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useSaveWebSearchSettings,
  useWebSearchSettings,
} from "@/hooks/use-web-search-settings";
import { formatError } from "@/lib/client";

const BUILT_IN_VALUE = "__web_search_builtin__";

/**
 * Mirrors WEB_SEARCH_PROVIDER_ENDPOINTS in packages/core/src/web-search-config.ts.
 * Duplicated because that module reads the config file and cannot be bundled
 * for the browser; the server re-derives the endpoint on save anyway.
 */
const PROVIDER_PRESETS: Array<{
  endpoint: string;
  label: string;
  value: WebSearchProvider;
}> = [
  { endpoint: "https://api.exa.ai/search", label: "Exa", value: "exa" },
  {
    endpoint: "https://api.firecrawl.dev/v2/search",
    label: "Firecrawl",
    value: "firecrawl",
  },
];

function presetEndpoint(provider: WebSearchProvider): string {
  return (
    PROVIDER_PRESETS.find((preset) => preset.value === provider)?.endpoint ?? ""
  );
}

export function WebSearchSettingsCard() {
  const { data: settings } = useWebSearchSettings();
  const saveMutation = useSaveWebSearchSettings();
  const [provider, setProvider] = useState<WebSearchProvider | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProvider(settings.provider);
    setEndpoint(settings.endpoint ?? "");
    setApiKey("");
  }, [settings]);

  useEffect(() => {
    if (!savedHint) {
      return;
    }

    const timeout = window.setTimeout(() => setSavedHint(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [savedHint]);

  const savedProvider = settings?.provider ?? null;
  const keyAlreadySaved =
    savedProvider === provider && Boolean(settings?.apiKeyMasked);

  function handleProviderChange(value: string | null) {
    if (!value) {
      return;
    }

    setFormError(null);
    setSavedHint(null);
    saveMutation.reset();

    if (value === BUILT_IN_VALUE) {
      setProvider(null);
      setEndpoint("");
      setApiKey("");

      saveMutation.mutate(
        { provider: null },
        {
          onError: (error) => setFormError(formatError(error)),
          onSuccess: () => setSavedHint("Using built-in web search"),
        }
      );
      return;
    }

    const next = value as WebSearchProvider;
    setProvider(next);
    setEndpoint(
      savedProvider === next ? (settings?.endpoint ?? "") : presetEndpoint(next)
    );
    setApiKey("");
  }

  function handleSave() {
    if (!provider) {
      return;
    }

    setFormError(null);
    setSavedHint(null);
    saveMutation.reset();

    saveMutation.mutate(
      {
        endpoint: endpoint.trim(),
        provider,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      {
        onError: (error) => setFormError(formatError(error)),
        onSuccess: (saved) => {
          setEndpoint(saved.endpoint ?? "");
          setApiKey("");
          setSavedHint("Saved");
        },
      }
    );
  }

  return (
    <div className="space-y-3 px-4 py-3" id="web-search-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Web search</p>
          {savedHint ? (
            <p
              className="text-emerald-700 text-xs dark:text-emerald-300"
              role="status"
            >
              {savedHint}
            </p>
          ) : null}
        </div>
        <div className="w-full min-w-0 sm:w-56">
          <Select
            disabled={saveMutation.isPending}
            onValueChange={handleProviderChange}
            value={provider ?? BUILT_IN_VALUE}
          >
            <SelectTrigger
              aria-label="Web search provider"
              className="h-9 w-full"
              id="web-search-provider"
            >
              <SelectValue placeholder="Built-in" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value={BUILT_IN_VALUE}>Built-in (default)</SelectItem>
              {PROVIDER_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {provider ? (
        <div className="space-y-2">
          <label
            className="block font-medium text-foreground text-xs"
            htmlFor="web-search-endpoint"
          >
            Endpoint
          </label>
          <Input
            autoComplete="off"
            className="h-9"
            disabled={saveMutation.isPending}
            id="web-search-endpoint"
            onChange={(event) => {
              setEndpoint(event.target.value);
              setFormError(null);
              setSavedHint(null);
            }}
            placeholder="https://api.exa.ai/search"
            value={endpoint}
          />

          <label
            className="block font-medium text-foreground text-xs"
            htmlFor="web-search-api-key"
          >
            API key
          </label>
          <div className="flex items-center gap-2">
            <InputGroup className="h-9 min-w-0 flex-1">
              <InputGroupInput
                autoComplete="off"
                disabled={saveMutation.isPending}
                id="web-search-api-key"
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setFormError(null);
                  setSavedHint(null);
                }}
                placeholder={
                  keyAlreadySaved
                    ? `Saved (${settings?.apiKeyMasked})`
                    : "Paste API key"
                }
                type={showApiKey ? "text" : "password"}
                value={apiKey}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  onClick={() => setShowApiKey((current) => !current)}
                  size="icon-xs"
                  type="button"
                >
                  {showApiKey ? (
                    <ViewOffIcon className="size-4" />
                  ) : (
                    <ViewIcon className="size-4" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Button
              className="min-w-[4.5rem] shrink-0"
              disabled={saveMutation.isPending || !endpoint.trim()}
              id="btn-web-search-save"
              onClick={handleSave}
              size="sm"
              type="button"
            >
              {saveMutation.isPending ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <p className="text-destructive text-xs" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
