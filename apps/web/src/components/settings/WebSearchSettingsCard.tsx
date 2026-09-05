import type { WebSearchProvider } from "@nakama/core/contract";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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

const PROVIDER_PRESETS: Array<{
  label: string;
  value: WebSearchProvider;
}> = [
  { label: "Exa", value: "exa" },
  { label: "Firecrawl", value: "firecrawl" },
];

function useSavedHint() {
  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!savedHint) {
      return;
    }

    const timeout = window.setTimeout(() => setSavedHint(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [savedHint]);

  return [savedHint, setSavedHint] as const;
}

function useWebSearchSettingsForm() {
  const { data: settings } = useWebSearchSettings();
  const saveMutation = useSaveWebSearchSettings();
  const [provider, setProvider] = useState<WebSearchProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useSavedHint();

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProvider(settings.provider);
    setApiKey("");
  }, [settings]);

  const keyAlreadySaved =
    settings?.provider === provider && Boolean(settings?.apiKeyMasked);

  function resetMessages() {
    setFormError(null);
    setSavedHint(null);
    saveMutation.reset();
  }

  function selectProvider(value: string | null) {
    if (!value) {
      return;
    }

    resetMessages();

    if (value === BUILT_IN_VALUE) {
      setProvider(null);
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

    setProvider(value as WebSearchProvider);
    setApiKey("");
  }

  function saveKey() {
    if (!provider) {
      return;
    }

    resetMessages();
    saveMutation.mutate(
      {
        provider,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      {
        onError: (error) => setFormError(formatError(error)),
        onSuccess: () => {
          setApiKey("");
          setSavedHint("Saved");
        },
      }
    );
  }

  return {
    apiKey,
    formError,
    keyAlreadySaved,
    maskedKey: settings?.apiKeyMasked,
    pending: saveMutation.isPending,
    provider,
    savedHint,
    saveKey,
    selectProvider,
    setApiKey,
    setFormError,
    setSavedHint,
  };
}

function WebSearchApiKeyFields({
  apiKey,
  keyAlreadySaved,
  maskedKey,
  pending,
  onApiKeyChange,
  onSave,
}: {
  apiKey: string;
  keyAlreadySaved: boolean;
  maskedKey: string | null | undefined;
  pending: boolean;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="space-y-2">
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
            disabled={pending}
            id="web-search-api-key"
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={
              keyAlreadySaved ? `Saved (${maskedKey})` : "Paste API key"
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
          disabled={pending || !(apiKey.trim() || keyAlreadySaved)}
          id="btn-web-search-save"
          onClick={onSave}
          size="sm"
          type="button"
        >
          {pending ? <Spinner className="size-4" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function WebSearchSettingsCard() {
  const form = useWebSearchSettingsForm();

  return (
    <div className="space-y-3 px-4 py-3" id="web-search-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm">Web search</p>
          {form.savedHint ? (
            <p
              className="text-emerald-700 text-xs dark:text-emerald-300"
              role="status"
            >
              {form.savedHint}
            </p>
          ) : null}
        </div>
        <div className="w-full min-w-0 sm:w-56">
          <Select
            disabled={form.pending}
            onValueChange={form.selectProvider}
            value={form.provider ?? BUILT_IN_VALUE}
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

      {form.provider ? (
        <WebSearchApiKeyFields
          apiKey={form.apiKey}
          keyAlreadySaved={form.keyAlreadySaved}
          maskedKey={form.maskedKey}
          onApiKeyChange={(value) => {
            form.setApiKey(value);
            form.setFormError(null);
            form.setSavedHint(null);
          }}
          onSave={form.saveKey}
          pending={form.pending}
        />
      ) : null}

      {form.formError ? (
        <p className="text-destructive text-xs" role="alert">
          {form.formError}
        </p>
      ) : null}
    </div>
  );
}
