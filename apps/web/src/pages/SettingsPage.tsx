import type { ProviderModelOption } from "@tinyclaw/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
} from "lucide-react";
import { ProviderOptionCards, ProviderSetupForm } from "@/components/ProviderSetupForm";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserContextCard } from "@/components/UserContextCard";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useAppContext } from "@/context/app-context";
import { useModelsQuery } from "@/hooks/use-app-queries";
import {
  isThinkingEffort,
  useSaveThinkingSettings,
  useThinkingSettings,
} from "@/hooks/use-thinking-settings";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { formatError } from "@/lib/client";
import {
  apiKeyPlaceholder,
  defaultModelForProvider,
  filterModelsByProvider,
  formatProviderLabel,
  getModelDisplayName,
  PROVIDER_OPTIONS,
  type SelectedProvider,
  resolveModelForProvider,
  validateApiKeyForProvider,
  validateCustomOpenRouterModel,
} from "@/lib/models";
import { getBrowserTimezone } from "@/lib/timezones";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const { health, models, configureProvider, setModel } = useAppContext();
  const { data: catalogResponse, isLoading: catalogLoading, error: catalogQueryError } =
    useModelsQuery();
  const catalog = catalogResponse?.models ?? [];
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [modelSaveHint, setModelSaveHint] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const [timezoneHint, setTimezoneHint] = useState<string | null>(null);
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();
  const { data: savedThinking } = useThinkingSettings();
  const saveThinkingMutation = useSaveThinkingSettings();
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<"low" | "medium" | "high">("medium");
  const [thinkingHint, setThinkingHint] = useState<string | null>(null);

  const isConfigured = health?.providerConfigured === true && models != null;

  useEffect(() => {
    if (catalogQueryError) {
      setFormError(formatError(catalogQueryError));
    }
  }, [catalogQueryError]);

  useEffect(() => {
    if (
      models?.provider === "openai" ||
      models?.provider === "anthropic" ||
      models?.provider === "openrouter" ||
      models?.provider === "gemini"
    ) {
      setModelDraft(models.currentModel ?? "");
    }
  }, [models?.provider, models?.currentModel]);

  useEffect(() => {
    if (isConfigured) {
      setReplaceKeyOpen(false);
    }
  }, [isConfigured]);

  const configuredModels = useMemo(
    () => filterModelsByProvider(catalog, models?.provider),
    [catalog, models?.provider],
  );

  const clearFieldErrors = useCallback(() => {
    setApiKeyError(null);
    setFormError(null);
  }, []);

  const handleApiKeyBlur = useCallback(() => {
    setApiKeyTouched(true);

    if (!apiKey.trim()) {
      setApiKeyError(null);
      return;
    }

    setApiKeyError(validateApiKeyForProvider(apiKey));
  }, [apiKey]);

  const handleApiKeyChange = useCallback(
    (value: string) => {
      setApiKey(value);
      setSuccessMessage(null);

      if (formError) {
        setFormError(null);
      }

      if (apiKeyTouched && value.trim()) {
        setApiKeyError(validateApiKeyForProvider(value));
      } else if (apiKeyError) {
        setApiKeyError(null);
      }
    },
    [apiKeyTouched, apiKeyError, formError],
  );

  const handleSubmitReplaceKey = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const trimmedKey = apiKey.trim();
      const nextApiKeyError = validateApiKeyForProvider(trimmedKey);

      setApiKeyTouched(true);
      setApiKeyError(nextApiKeyError);

      if (nextApiKeyError) {
        document.getElementById("replace-api-key")?.focus();
        return;
      }

      const modelToSave = models?.currentModel ?? "";

      setBusy(true);
      setFormError(null);
      setSuccessMessage(null);
      setModelSaveHint(null);

      try {
        await configureProvider(
          trimmedKey,
          modelToSave || undefined,
          models!.provider as SelectedProvider,
        );
        setApiKey("");
        setApiKeyTouched(false);
        setShowApiKey(false);
        setReplaceKeyOpen(false);
        setSuccessMessage("API key updated.");
      } catch (err) {
        setFormError(formatError(err));
        document.getElementById("replace-api-key")?.focus();
      } finally {
        setBusy(false);
      }
    },
    [apiKey, configureProvider, models],
  );

  const closeReplaceKeyForm = useCallback(() => {
    setReplaceKeyOpen(false);
    setApiKey("");
    setApiKeyTouched(false);
    setApiKeyError(null);
    clearFieldErrors();
  }, [clearFieldErrors]);

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  useEffect(() => {
    if (savedThinking) {
      setThinkingEnabled(savedThinking.enabled);
      setThinkingEffort(savedThinking.effort);
    }
  }, [savedThinking]);

  const handleSaveTimezone = useCallback(() => {
    setFormError(null);
    setTimezoneHint(null);

    saveTimezoneMutation.mutate(timezone.trim(), {
      onSuccess: (saved) => {
        setTimezone(saved);
        setTimezoneHint(`Saved · ${saved}`);
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  }, [saveTimezoneMutation, timezone]);

  const handleSaveThinking = useCallback(() => {
    setFormError(null);
    setThinkingHint(null);

    saveThinkingMutation.mutate(
      { enabled: thinkingEnabled, effort: thinkingEffort },
      {
        onSuccess: (saved) => {
          setThinkingEnabled(saved.enabled);
          setThinkingEffort(saved.effort);
          setThinkingHint(
            saved.enabled ? `Saved · ${saved.effort} effort` : "Saved · thinking off",
          );
        },
        onError: (err) => {
          setFormError(formatError(err));
        },
      },
    );
  }, [saveThinkingMutation, thinkingEnabled, thinkingEffort]);

  const handleSaveModel = useCallback(async () => {
    if (!modelDraft || modelDraft === models?.currentModel) {
      return;
    }

    setModelBusy(true);
    setFormError(null);
    setModelSaveHint(null);

    try {
      await setModel(modelDraft);
      setModelSaveHint(
        `Saved · ${getModelDisplayName(catalog, modelDraft)}`,
      );
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setModelBusy(false);
    }
  }, [modelDraft, models?.currentModel, setModel, catalog]);

  if (catalogLoading) {
    return (
      <div className="space-y-8">
        <SettingsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <Card className="w-full">
        <CardHeader className="pb-2">
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Interface color theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader className="pb-2">
          <CardTitle>Timezone</CardTitle>
          <CardDescription>Default for scheduled automations.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-md space-y-2">
          <div className="flex items-center gap-2">
            <TimezoneSelect
              id="timezone"
              className="min-w-0 flex-1"
              value={timezone}
              disabled={saveTimezoneMutation.isPending}
              emptyLabel="Select timezone"
              onValueChange={(nextTimezone) => {
                if (nextTimezone) {
                  setTimezone(nextTimezone);
                  setTimezoneHint(null);
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={saveTimezoneMutation.isPending || !timezone.trim()}
              onClick={handleSaveTimezone}
            >
              {saveTimezoneMutation.isPending ? (
                <>
                  <Spinner className="mr-2" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
          {timezoneHint ? (
            <p className="text-xs text-emerald-200" role="status">
              {timezoneHint}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader className="pb-2">
          <CardTitle>Extended thinking</CardTitle>
          <CardDescription>
            Show the model&apos;s reasoning while it works. Uses more tokens when enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-md space-y-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="size-4 rounded border-border"
              checked={thinkingEnabled}
              disabled={saveThinkingMutation.isPending}
              onChange={(event) => {
                setThinkingEnabled(event.target.checked);
                setThinkingHint(null);
              }}
            />
            <span className="text-sm text-foreground">Enable thinking in chat</span>
          </label>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Reasoning depth</p>
            <Select
              value={thinkingEffort}
              disabled={!thinkingEnabled || saveThinkingMutation.isPending}
              onValueChange={(value) => {
                if (isThinkingEffort(value)) {
                  setThinkingEffort(value);
                  setThinkingHint(null);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            size="sm"
            disabled={saveThinkingMutation.isPending}
            onClick={handleSaveThinking}
          >
            {saveThinkingMutation.isPending ? (
              <>
                <Spinner className="mr-2" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>

          {thinkingHint ? (
            <p className="text-xs text-emerald-200" role="status">
              {thinkingHint}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <UserContextCard />

      <TelegramSettingsCard />

      <Card>
        {!isConfigured ? (
          <CardHeader>
            <div className="flex items-start gap-3">
              <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-200" />
              <div className="space-y-1">
                <CardTitle className="text-amber-100">No provider connected</CardTitle>
                <CardDescription className="text-amber-200/90">
                  Chat runs in offline mode until you connect OpenAI or Anthropic below.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        ) : null}

        <CardContent className={cn("space-y-5", isConfigured && "pt-4")}>
          {!isConfigured ? (
            <ProviderSetupForm
              onSuccess={() => {
                setSuccessMessage("Provider connected.");
              }}
            />
          ) : (
            <ConnectedProviderSection
              models={models}
              configuredModels={configuredModels}
              modelDraft={modelDraft}
              modelBusy={modelBusy}
              modelDirty={modelDraft !== models.currentModel}
              modelSaveHint={modelSaveHint}
              formError={formError}
              replaceKeyOpen={replaceKeyOpen}
              apiKey={apiKey}
              showApiKey={showApiKey}
              apiKeyError={apiKeyError}
              replaceKeyBusy={busy}
              onModelDraftChange={(value) => {
                setModelDraft(value);
                setModelSaveHint(null);
                if (formError) {
                  setFormError(null);
                }
              }}
              onSaveModel={() => void handleSaveModel()}
              onOpenReplaceKey={() => {
                setReplaceKeyOpen(true);
                setSuccessMessage(null);
                clearFieldErrors();
              }}
              onCancelReplaceKey={closeReplaceKeyForm}
              onApiKeyChange={handleApiKeyChange}
              onApiKeyBlur={handleApiKeyBlur}
              onToggleShowApiKey={() => setShowApiKey((current) => !current)}
              onSubmitReplaceKey={(event) => void handleSubmitReplaceKey(event)}
            />
          )}
        </CardContent>
      </Card>

      {successMessage ? (
        <div className="flex items-start gap-3" role="status" aria-live="polite">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-300" />
          <p className="text-sm text-emerald-100">{successMessage}</p>
        </div>
      ) : null}

      <details className="group border-t border-border pt-8">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 font-medium text-foreground transition-colors marker:content-none hover:text-primary [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 group-open:text-foreground"
            aria-hidden="true"
          />
          <span>Advanced</span>
          <span className="text-sm font-normal text-muted-foreground group-open:hidden">
            Show storage and provider options
          </span>
        </summary>
        <div className="mt-6 space-y-8">
          <p className="max-w-2xl leading-relaxed">
            Credentials are saved to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.tinyclaw/config.ini</code>{" "}
            on the server. In Docker, this persists on the config volume.
          </p>

          {isConfigured && models?.provider ? (
            <div className="border-t border-border pt-8">
              <SwitchProviderSection
                currentProvider={models.provider as SelectedProvider}
                catalog={catalog}
                configureProvider={configureProvider}
                onSuccess={(message) => {
                  setSuccessMessage(message);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse" aria-hidden="true">
      <div className="h-4 w-2/3 rounded bg-muted" />
      <Card>
        <CardContent className="space-y-5 pt-4">
          <div className="space-y-2">
            <div className="h-4 w-12 rounded bg-muted" />
            <div className="h-10 max-w-sm rounded-lg bg-muted" />
          </div>
          <div className="border-t border-border pt-4">
            <div className="h-4 w-40 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SwitchProviderSection({
  currentProvider,
  catalog,
  configureProvider,
  onSuccess,
}: {
  currentProvider: SelectedProvider;
  catalog: ProviderModelOption[];
  configureProvider: ReturnType<typeof useAppContext>["configureProvider"];
  onSuccess: (message: string) => void;
}) {
  const defaultTarget =
    PROVIDER_OPTIONS.find((option) => option.id !== currentProvider)?.id ?? "openai";
  const [targetProvider, setTargetProvider] = useState<SelectedProvider>(defaultTarget);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customModelError, setCustomModelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setTargetProvider((current) =>
      current === currentProvider
        ? (PROVIDER_OPTIONS.find((option) => option.id !== currentProvider)?.id ?? "openai")
        : current,
    );
  }, [currentProvider]);

  const targetModels = useMemo(
    () => filterModelsByProvider(catalog, targetProvider),
    [catalog, targetProvider],
  );

  useEffect(() => {
    if (targetModels.length === 0) {
      return;
    }

    setSelectedModel((current) => {
      if (current && targetModels.some((model) => model.id === current)) {
        return current;
      }

      return defaultModelForProvider(catalog, targetProvider);
    });
  }, [targetProvider, targetModels, catalog]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedKey = apiKey.trim();
    const nextApiKeyError = validateApiKeyForProvider(trimmedKey);
    const nextCustomModelError =
      targetProvider === "openrouter" ? validateCustomOpenRouterModel(customModel) : null;

    setApiKeyTouched(true);
    setApiKeyError(nextApiKeyError);
    setCustomModelError(nextCustomModelError);
    setLocalError(null);

    if (nextApiKeyError) {
      document.getElementById("switch-api-key")?.focus();
      return;
    }

    if (nextCustomModelError) {
      document.getElementById("switch-custom-model")?.focus();
      return;
    }

    const modelToSave = resolveModelForProvider(
      targetProvider,
      selectedModel,
      customModel,
    );

    setBusy(true);

    try {
      const result = await configureProvider(
        trimmedKey,
        modelToSave || undefined,
        targetProvider,
      );
      setApiKey("");
      setApiKeyTouched(false);
      setShowApiKey(false);
      setCustomModel("");
      onSuccess(
        `Switched to ${formatProviderLabel(result.provider)} with ${getModelDisplayName(catalog, result.currentModel)}.`,
      );
    } catch (err) {
      setLocalError(formatError(err));
      document.getElementById("switch-api-key")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Switch provider</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Move from {formatProviderLabel(currentProvider)} to{" "}
          {formatProviderLabel(targetProvider)} with a new API key and default model. Chat history
          resets when you switch providers.
        </p>
      </div>

      <ProviderOptionCards
        selectedProvider={targetProvider}
        disabled={busy}
        onSelect={(provider) => {
          setTargetProvider(provider);
          setLocalError(null);
          if (provider !== "openrouter") {
            setCustomModel("");
            setCustomModelError(null);
          }
          if (apiKeyTouched && apiKey.trim()) {
            setApiKeyError(validateApiKeyForProvider(apiKey));
          }
        }}
      />

      <div className="space-y-2">
        <label htmlFor="switch-api-key" className="text-sm font-medium text-foreground">
          API key
        </label>
        <InputGroup>
          <InputGroupInput
            id="switch-api-key"
            type={showApiKey ? "text" : "password"}
            autoComplete="off"
            placeholder={apiKeyPlaceholder(targetProvider)}
            value={apiKey}
            disabled={busy}
            aria-invalid={apiKeyError != null}
            aria-describedby={apiKeyError ? "switch-api-key-error" : "switch-api-key-hint"}
            onBlur={() => {
              setApiKeyTouched(true);
              if (!apiKey.trim()) {
                setApiKeyError(null);
                return;
              }
              setApiKeyError(validateApiKeyForProvider(apiKey));
            }}
            onChange={(event) => {
              const value = event.target.value;
              setApiKey(value);
              setLocalError(null);
              if (apiKeyTouched && value.trim()) {
                setApiKeyError(validateApiKeyForProvider(value));
              } else if (apiKeyError) {
                setApiKeyError(null);
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-sm"
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
              onClick={() => setShowApiKey((current) => !current)}
            >
              {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {apiKeyError ? (
          <p id="switch-api-key-error" className="text-sm text-destructive" role="alert">
            {apiKeyError}
          </p>
        ) : (
          <p id="switch-api-key-hint" className="text-xs text-muted-foreground">
            Paste the API key from your {formatProviderLabel(targetProvider)} dashboard.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="switch-model" className="text-sm font-medium text-foreground">
          Model
        </label>
        <Select
          value={selectedModel}
          disabled={busy || targetModels.length === 0}
          onValueChange={(value) => setSelectedModel(value != null ? String(value) : "")}
        >
          <SelectTrigger id="switch-model" className="w-full sm:max-w-sm">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {targetModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
                {model.default ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {targetProvider === "openrouter" ? (
        <div className="space-y-2">
          <label htmlFor="switch-custom-model" className="text-sm font-medium text-foreground">
            Custom model ID <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <InputGroup>
            <InputGroupInput
              id="switch-custom-model"
              type="text"
              autoComplete="off"
              placeholder="anthropic/claude-sonnet-4-6"
              value={customModel}
              disabled={busy}
              aria-invalid={customModelError != null}
              aria-describedby={
                customModelError ? "switch-custom-model-error" : "switch-custom-model-hint"
              }
              onChange={(event) => {
                const value = event.target.value;
                setCustomModel(value);
                setCustomModelError(validateCustomOpenRouterModel(value));
              }}
            />
          </InputGroup>
          {customModelError ? (
            <p id="switch-custom-model-error" className="text-sm text-destructive" role="alert">
              {customModelError}
            </p>
          ) : (
            <p id="switch-custom-model-hint" className="text-xs text-muted-foreground">
              Overrides the catalog selection when set.
            </p>
          )}
        </div>
      ) : null}

      {localError ? (
        <p className="text-sm text-destructive" role="alert">
          {localError}
        </p>
      ) : null}

      <div className="pt-1">
        <Button type="submit" size="sm" disabled={busy || !apiKey.trim()}>
          {busy ? (
            <>
              <Spinner className="mr-2" />
              Switching…
            </>
          ) : (
            `Switch to ${formatProviderLabel(targetProvider)}`
          )}
        </Button>
      </div>
    </form>
  );
}

function ConnectedProviderSection({
  models,
  configuredModels,
  modelDraft,
  modelBusy,
  modelDirty,
  modelSaveHint,
  formError,
  replaceKeyOpen,
  apiKey,
  showApiKey,
  apiKeyError,
  replaceKeyBusy,
  onModelDraftChange,
  onSaveModel,
  onOpenReplaceKey,
  onCancelReplaceKey,
  onApiKeyChange,
  onApiKeyBlur,
  onToggleShowApiKey,
  onSubmitReplaceKey,
}: {
  models: NonNullable<ReturnType<typeof useAppContext>["models"]>;
  configuredModels: ProviderModelOption[];
  modelDraft: string;
  modelBusy: boolean;
  modelDirty: boolean;
  modelSaveHint: string | null;
  formError: string | null;
  replaceKeyOpen: boolean;
  apiKey: string;
  showApiKey: boolean;
  apiKeyError: string | null;
  replaceKeyBusy: boolean;
  onModelDraftChange: (value: string) => void;
  onSaveModel: () => void;
  onOpenReplaceKey: () => void;
  onCancelReplaceKey: () => void;
  onApiKeyChange: (value: string) => void;
  onApiKeyBlur: () => void;
  onToggleShowApiKey: () => void;
  onSubmitReplaceKey: (event: React.FormEvent) => void;
}) {
  const currentProvider = models.provider as SelectedProvider;

  return (
    <>
      <div className="space-y-3">
        <label htmlFor="connected-model" className="block text-sm font-medium text-foreground">
          Model
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={modelDraft}
            disabled={modelBusy || configuredModels.length === 0}
            onValueChange={(value) => onModelDraftChange(value != null ? String(value) : "")}
          >
            <SelectTrigger id="connected-model" className="w-full min-w-[220px] sm:max-w-sm">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {configuredModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                  {model.default ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {modelDirty ? (
            <Button
              type="button"
              size="sm"
              disabled={modelBusy || !modelDraft}
              onClick={onSaveModel}
            >
              {modelBusy ? (
                <>
                  <Spinner className="mr-2" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          ) : null}
          {modelSaveHint ? (
            <span className="text-xs text-emerald-300" role="status" aria-live="polite">
              {modelSaveHint}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Chat history resets when the model changes.
        </p>
        {formError && !replaceKeyOpen ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <KeyRoundIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">API key</span>
          <span className="font-medium text-foreground">Configured</span>
          {!replaceKeyOpen ? (
            <button
              type="button"
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              onClick={onOpenReplaceKey}
            >
              Replace key
            </button>
          ) : null}
        </div>

        {replaceKeyOpen ? (
          <form className="mt-4 space-y-3" onSubmit={onSubmitReplaceKey}>
            <InputGroup>
              <InputGroupInput
                id="replace-api-key"
                type={showApiKey ? "text" : "password"}
                autoComplete="off"
                placeholder={apiKeyPlaceholder(currentProvider)}
                value={apiKey}
                disabled={replaceKeyBusy}
                aria-invalid={apiKeyError != null}
                aria-describedby={
                  apiKeyError ? "replace-api-key-error" : "replace-api-key-hint"
                }
                onBlur={onApiKeyBlur}
                onChange={(event) => onApiKeyChange(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  onClick={onToggleShowApiKey}
                >
                  {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {apiKeyError ? (
              <p id="replace-api-key-error" className="text-sm text-destructive" role="alert">
                {apiKeyError}
              </p>
            ) : (
              <p id="replace-api-key-hint" className="text-xs text-muted-foreground">
                Paste the API key from your {formatProviderLabel(currentProvider)} dashboard.
              </p>
            )}
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={replaceKeyBusy || !apiKey.trim()}>
                {replaceKeyBusy ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save key"
                )}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                disabled={replaceKeyBusy}
                onClick={onCancelReplaceKey}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </>
  );
}
