import type { WebSearchProvider } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Spinner } from "@nakama/ui/spinner";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useEffect, useState } from "react";
import {
  useSaveWebSearchSettings,
  useWebSearchSettings,
} from "@/hooks/use-app-queries";
import { client, formatError } from "@/lib/client";

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
  const { data: settings, refetch } = useWebSearchSettings();
  const saveMutation = useSaveWebSearchSettings();
  // undefined follows the server; null is an explicit built-in selection.
  const [providerDraft, setProvider] = useState<
    WebSearchProvider | null | undefined
  >(undefined);
  const provider =
    providerDraft === undefined ? (settings?.provider ?? null) : providerDraft;
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useSavedHint();

  const keyAlreadySaved =
    settings?.provider === provider && settings?.configured === true;
  const managedByEnvironment =
    settings?.provider === provider && settings?.source === "environment";

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
          onSuccess: () => {
            setProvider(undefined);
            setSavedHint("Using built-in web search");
          },
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
          setProvider(undefined);
          setApiKey("");
          setSavedHint("Saved");
        },
      }
    );
  }

  async function manageKey(action: "clear" | "use-stored") {
    resetMessages();
    try {
      await client.manageSettingSecret("web-search", action);
      await refetch();
      setSavedHint(action === "clear" ? "Key cleared" : "Saved key selected");
    } catch (error) {
      setFormError(formatError(error));
    }
  }

  return {
    apiKey,
    formError,
    keyAlreadySaved,
    managedByEnvironment,
    manageKey,
    pending: saveMutation.isPending,
    provider,
    savedAvailable: settings?.provider === provider && settings.savedAvailable,
    savedHint,
    saveKey,
    selectProvider,
    setApiKey: (value: string) => {
      // Keep this key attached to the provider it was entered for.
      setProvider(provider);
      setApiKey(value);
    },
    setFormError,
    setSavedHint,
    source: settings?.provider === provider ? settings.source : "missing",
  };
}

function WebSearchApiKeyFields({
  apiKey,
  keyAlreadySaved,
  managedByEnvironment,
  pending,
  onApiKeyChange,
  onSave,
}: {
  apiKey: string;
  keyAlreadySaved: boolean;
  managedByEnvironment: boolean;
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
            disabled={pending || managedByEnvironment}
            id="web-search-api-key"
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={
              managedByEnvironment
                ? "Managed by environment"
                : keyAlreadySaved
                  ? "Saved"
                  : "Paste API key"
            }
            type={showApiKey ? "text" : "password"}
            value={apiKey}
          />
          {managedByEnvironment ? null : (
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
          )}
        </InputGroup>
        <Button
          className="min-w-[4.5rem] shrink-0"
          disabled={
            pending ||
            managedByEnvironment ||
            !(apiKey.trim() || keyAlreadySaved)
          }
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
        <>
          <WebSearchApiKeyFields
            apiKey={form.apiKey}
            keyAlreadySaved={form.keyAlreadySaved}
            managedByEnvironment={form.managedByEnvironment}
            onApiKeyChange={(value) => {
              form.setApiKey(value);
              form.setFormError(null);
              form.setSavedHint(null);
            }}
            onSave={form.saveKey}
            pending={form.pending}
          />
          {form.source === "settings" ||
          (form.source === "missing" && form.savedAvailable) ? (
            <Button
              onClick={() =>
                void form.manageKey(
                  form.source === "settings" ? "clear" : "use-stored"
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {form.source === "settings" ? "Clear saved key" : "Use saved key"}
            </Button>
          ) : null}
        </>
      ) : null}

      {form.formError ? (
        <p className="text-destructive text-xs" role="alert">
          {form.formError}
        </p>
      ) : null}
    </div>
  );
}
