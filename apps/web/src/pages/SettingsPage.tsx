import type { ProviderModelOption } from "@tinyclaw/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
} from "lucide-react";
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
import { client, formatError } from "@/lib/client";
import {
  inferProviderFromApiKey,
  type InferredProvider,
} from "@/lib/infer-provider";
import type { PageId } from "@/lib/navigation";
import {
  apiKeyHint,
  apiKeyPlaceholder,
  defaultModelForProvider,
  filterModelsByProvider,
  formatProviderLabel,
  getModelDisplayName,
  PROVIDER_OPTIONS,
  validateApiKeyForProvider,
} from "@/lib/models";
import { cn } from "@/lib/utils";

interface SettingsPageProps {
  onNavigate: (page: PageId) => void;
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { health, models, configureProvider, setModel } = useAppContext();
  const [catalog, setCatalog] = useState<ProviderModelOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<InferredProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showGoToChat, setShowGoToChat] = useState(false);
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [modelSaveHint, setModelSaveHint] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [timezoneBusy, setTimezoneBusy] = useState(false);
  const [timezoneHint, setTimezoneHint] = useState<string | null>(null);

  const isConfigured = health?.providerConfigured === true && models != null;

  useEffect(() => {
    setCatalogLoading(true);

    void client
      .getModels()
      .then((response) => {
        setCatalog(response.models);
      })
      .catch((err) => {
        setFormError(formatError(err));
      })
      .finally(() => {
        setCatalogLoading(false);
      });
  }, []);

  useEffect(() => {
    if (models?.provider === "openai" || models?.provider === "anthropic") {
      setSelectedProvider(models.provider);
      setModelDraft(models.currentModel ?? "");
    }
  }, [models?.provider, models?.currentModel]);

  useEffect(() => {
    if (isConfigured) {
      setReplaceKeyOpen(false);
    }
  }, [isConfigured]);

  const inferredProvider = useMemo(() => {
    const trimmed = apiKey.trim();
    return trimmed ? inferProviderFromApiKey(trimmed) : null;
  }, [apiKey]);

  useEffect(() => {
    if (isConfigured && replaceKeyOpen) {
      return;
    }

    if (inferredProvider && inferredProvider !== selectedProvider) {
      setSelectedProvider(inferredProvider);
    }
  }, [inferredProvider, selectedProvider, isConfigured, replaceKeyOpen]);

  const providerForValidation = useMemo(() => {
    if (isConfigured && replaceKeyOpen && models?.provider) {
      return models.provider as InferredProvider;
    }

    return selectedProvider;
  }, [isConfigured, replaceKeyOpen, models?.provider, selectedProvider]);

  const filteredModels = useMemo(
    () => filterModelsByProvider(catalog, selectedProvider),
    [catalog, selectedProvider],
  );

  const configuredModels = useMemo(
    () => filterModelsByProvider(catalog, models?.provider),
    [catalog, models?.provider],
  );

  useEffect(() => {
    if (filteredModels.length === 0) {
      return;
    }

    setSelectedModel((current) => {
      if (current && filteredModels.some((model) => model.id === current)) {
        return current;
      }

      return defaultModelForProvider(catalog, selectedProvider);
    });
  }, [selectedProvider, filteredModels, catalog]);

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

    setApiKeyError(validateApiKeyForProvider(apiKey, providerForValidation));
  }, [apiKey, providerForValidation]);

  const handleApiKeyChange = useCallback(
    (value: string) => {
      setApiKey(value);
      setSuccessMessage(null);
      setShowGoToChat(false);

      if (formError) {
        setFormError(null);
      }

      if (apiKeyTouched && value.trim()) {
        setApiKeyError(validateApiKeyForProvider(value, providerForValidation));
      } else if (apiKeyError) {
        setApiKeyError(null);
      }
    },
    [apiKeyTouched, apiKeyError, formError, providerForValidation],
  );

  const handleProviderSelect = useCallback(
    (provider: InferredProvider) => {
      setSelectedProvider(provider);
      setSuccessMessage(null);
      setShowGoToChat(false);

      if (apiKeyTouched && apiKey.trim()) {
        setApiKeyError(validateApiKeyForProvider(apiKey, provider));
      }
    },
    [apiKey, apiKeyTouched],
  );

  const handleSubmitCredentials = useCallback(
    async (event: React.FormEvent, mode: "initial" | "replace") => {
      event.preventDefault();

      const trimmedKey = apiKey.trim();
      const validationProvider =
        mode === "replace" ? (models!.provider as InferredProvider) : selectedProvider;
      const nextApiKeyError = validateApiKeyForProvider(trimmedKey, validationProvider);
      const focusTargetId = mode === "replace" ? "replace-api-key" : "api-key";

      setApiKeyTouched(true);
      setApiKeyError(nextApiKeyError);

      if (nextApiKeyError) {
        document.getElementById(focusTargetId)?.focus();
        return;
      }

      const wasConfigured = isConfigured;
      const modelToSave =
        mode === "replace" ? models?.currentModel ?? selectedModel : selectedModel;

      setBusy(true);
      setFormError(null);
      setSuccessMessage(null);
      setShowGoToChat(false);
      setModelSaveHint(null);

      try {
        const result = await configureProvider(
          trimmedKey,
          modelToSave || undefined,
        );
        setApiKey("");
        setApiKeyTouched(false);
        setShowApiKey(false);
        setReplaceKeyOpen(false);
        setSuccessMessage(
          wasConfigured
            ? "API key updated."
            : `${formatProviderLabel(result.provider)} connected with ${getModelDisplayName(catalog, result.currentModel)}.`,
        );
        setShowGoToChat(!wasConfigured);
      } catch (err) {
        setFormError(formatError(err));
        document.getElementById(focusTargetId)?.focus();
      } finally {
        setBusy(false);
      }
    },
    [
      apiKey,
      selectedModel,
      selectedProvider,
      configureProvider,
      isConfigured,
      models,
      catalog,
    ],
  );

  const closeReplaceKeyForm = useCallback(() => {
    setReplaceKeyOpen(false);
    setApiKey("");
    setApiKeyTouched(false);
    setApiKeyError(null);
    if (models?.provider === "openai" || models?.provider === "anthropic") {
      setSelectedProvider(models.provider);
    }
    clearFieldErrors();
  }, [clearFieldErrors, models?.provider]);

  useEffect(() => {
    void client
      .getTimezone()
      .then((value) => setTimezone(value))
      .catch(() => {
        // keep browser default
      });
  }, []);

  const handleSaveTimezone = useCallback(async () => {
    setTimezoneBusy(true);
    setFormError(null);
    setTimezoneHint(null);

    try {
      const saved = await client.setTimezone(timezone.trim());
      setTimezone(saved);
      setTimezoneHint(`Saved · ${saved}`);
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setTimezoneBusy(false);
    }
  }, [timezone]);

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
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          Connect OpenAI or Anthropic to enable chat, tools, and automations.
        </p>
      </div>

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
        ) : (
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <StatusPill label="Connected" tone="ok" />
            <ProviderBadge provider={models.provider} />
          </CardHeader>
        )}

        <CardContent className="space-y-5">
          {!isConfigured ? (
            <form
              className="space-y-5"
              onSubmit={(event) => void handleSubmitCredentials(event, "initial")}
            >
              <div>
                <h3 className="text-sm font-medium text-foreground">Connect a provider</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose OpenAI or Anthropic, paste your API key, and pick a default model.
                </p>
              </div>

              <ProviderOptionCards
                selectedProvider={selectedProvider}
                disabled={busy}
                onSelect={handleProviderSelect}
              />

              <div className="space-y-2">
                <label htmlFor="api-key" className="text-sm font-medium text-foreground">
                  API key
                </label>
                <InputGroup>
                  <InputGroupInput
                    id="api-key"
                    type={showApiKey ? "text" : "password"}
                    autoComplete="off"
                    placeholder={apiKeyPlaceholder(selectedProvider)}
                    value={apiKey}
                    disabled={busy}
                    aria-invalid={apiKeyError != null}
                    aria-describedby={apiKeyError ? "api-key-error" : "api-key-hint"}
                    onBlur={handleApiKeyBlur}
                    onChange={(event) => handleApiKeyChange(event.target.value)}
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
                  <p id="api-key-error" className="text-sm text-destructive" role="alert">
                    {apiKeyError}
                  </p>
                ) : (
                  <p id="api-key-hint" className="text-xs text-muted-foreground">
                    {apiKeyHint(selectedProvider)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="model" className="text-sm font-medium text-foreground">
                  Model
                </label>
                <Select
                  value={selectedModel}
                  disabled={busy || filteredModels.length === 0}
                  onValueChange={(value) => setSelectedModel(value != null ? String(value) : "")}
                >
                  <SelectTrigger id="model" className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                        {model.default ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formError ? (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !apiKey.trim()}>
                  {busy ? (
                    <>
                      <Spinner className="mr-2" />
                      Saving…
                    </>
                  ) : (
                    "Save & continue"
                  )}
                </Button>
              </div>
            </form>
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
                setShowGoToChat(false);
                clearFieldErrors();
              }}
              onCancelReplaceKey={closeReplaceKeyForm}
              onApiKeyChange={handleApiKeyChange}
              onApiKeyBlur={handleApiKeyBlur}
              onToggleShowApiKey={() => setShowApiKey((current) => !current)}
              onSubmitReplaceKey={(event) => void handleSubmitCredentials(event, "replace")}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <CardDescription>
            Used for scheduled automations when no timezone is specified on the automation itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="timezone" className="text-sm font-medium text-foreground">
              IANA timezone
            </label>
            <InputGroup>
              <InputGroupInput
                id="timezone"
                value={timezone}
                disabled={timezoneBusy}
                placeholder="America/Los_Angeles"
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setTimezoneHint(null);
                }}
              />
            </InputGroup>
            <p className="text-xs text-muted-foreground">
              Browser default: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={timezoneBusy || !timezone.trim()}
              onClick={() => void handleSaveTimezone()}
            >
              {timezoneBusy ? (
                <>
                  <Spinner className="mr-2" />
                  Saving…
                </>
              ) : (
                "Save timezone"
              )}
            </Button>
            {timezoneHint ? (
              <p className="text-sm text-emerald-200" role="status">
                {timezoneHint}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {successMessage ? (
        <div className="flex items-start gap-3" role="status" aria-live="polite">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-emerald-100">{successMessage}</p>
            {showGoToChat ? (
              <Button type="button" onClick={() => onNavigate("chat")}>
                Go to Chat
                <ArrowRightIcon className="size-4" />
              </Button>
            ) : null}
          </div>
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
                currentProvider={models.provider as InferredProvider}
                catalog={catalog}
                configureProvider={configureProvider}
                onSuccess={(message) => {
                  setSuccessMessage(message);
                  setShowGoToChat(false);
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
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="h-7 w-24 rounded-full bg-muted" />
          <div className="h-7 w-20 rounded-full bg-muted" />
        </CardHeader>
        <CardContent className="space-y-5">
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

function ProviderOptionCards({
  selectedProvider,
  disabled,
  onSelect,
}: {
  selectedProvider: InferredProvider;
  disabled?: boolean;
  onSelect: (provider: InferredProvider) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">Provider</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PROVIDER_OPTIONS.map((option) => {
          const active = selectedProvider === option.id;

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(option.id)}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                  : "border-border bg-background hover:bg-muted/50",
              )}
            >
              <p className="text-sm font-medium text-foreground">{option.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {option.id === "openai" ? "GPT models" : "Claude models"}
              </p>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SwitchProviderSection({
  currentProvider,
  catalog,
  configureProvider,
  onSuccess,
}: {
  currentProvider: InferredProvider;
  catalog: ProviderModelOption[];
  configureProvider: ReturnType<typeof useAppContext>["configureProvider"];
  onSuccess: (message: string) => void;
}) {
  const defaultTarget = currentProvider === "openai" ? "anthropic" : "openai";
  const [targetProvider, setTargetProvider] = useState<InferredProvider>(defaultTarget);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setTargetProvider(currentProvider === "openai" ? "anthropic" : "openai");
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

  const inferredProvider = useMemo(() => {
    const trimmed = apiKey.trim();
    return trimmed ? inferProviderFromApiKey(trimmed) : null;
  }, [apiKey]);

  useEffect(() => {
    if (inferredProvider && inferredProvider !== targetProvider) {
      setTargetProvider(inferredProvider);
    }
  }, [inferredProvider, targetProvider]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedKey = apiKey.trim();
    const nextApiKeyError = validateApiKeyForProvider(trimmedKey, targetProvider);

    setApiKeyTouched(true);
    setApiKeyError(nextApiKeyError);
    setLocalError(null);

    if (nextApiKeyError) {
      document.getElementById("switch-api-key")?.focus();
      return;
    }

    setBusy(true);

    try {
      const result = await configureProvider(trimmedKey, selectedModel || undefined);
      setApiKey("");
      setApiKeyTouched(false);
      setShowApiKey(false);
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
          if (apiKeyTouched && apiKey.trim()) {
            setApiKeyError(validateApiKeyForProvider(apiKey, provider));
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
              setApiKeyError(validateApiKeyForProvider(apiKey, targetProvider));
            }}
            onChange={(event) => {
              const value = event.target.value;
              setApiKey(value);
              setLocalError(null);
              if (apiKeyTouched && value.trim()) {
                setApiKeyError(validateApiKeyForProvider(value, targetProvider));
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
            {apiKeyHint(targetProvider)}
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
  const currentProvider = models.provider as InferredProvider;

  return (
    <>
      <div className="space-y-2">
        <label htmlFor="connected-model" className="text-sm font-medium text-foreground">
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
                {apiKeyHint(currentProvider)}
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

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-200"
      : "border-border bg-muted text-muted-foreground";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", toneClass)}>
      {label}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string | null }) {
  if (!provider) {
    return null;
  }

  const isOpenAI = provider === "openai";

  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        isOpenAI
          ? "border-sky-800/60 bg-sky-950/40 text-sky-200"
          : "border-orange-800/60 bg-orange-950/40 text-orange-200",
      )}
    >
      {formatProviderLabel(provider)}
    </span>
  );
}
