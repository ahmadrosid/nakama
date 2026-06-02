import type { ProviderModelOption } from "@tinyclaw/core/contract";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
} from "lucide-react";
import { ProviderSelect, ProviderSetupForm } from "@/components/ProviderSetupForm";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserContextSettings } from "@/components/UserContextCard";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
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
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Appearance</p>
            <p className="text-xs text-muted-foreground">Color theme</p>
          </div>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardContent className="divide-y divide-border p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Timezone</p>
              {timezoneHint ? (
                <p className="text-xs text-emerald-200" role="status">
                  {timezoneHint}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">For scheduled automations</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <TimezoneSelect
                id="timezone"
                className="w-[11rem] min-w-0 sm:w-[13rem]"
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
          </div>

          <UserContextSettings />
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Extended thinking</p>
              {thinkingHint ? (
                <p className="text-xs text-emerald-200" role="status">
                  {thinkingHint}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Show reasoning in chat · uses more tokens
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                id="thinking-enabled"
                checked={thinkingEnabled}
                disabled={saveThinkingMutation.isPending}
                aria-label="Enable thinking in chat"
                onCheckedChange={(enabled) => {
                  setThinkingEnabled(enabled);
                  setThinkingHint(null);
                }}
              />
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
                <SelectTrigger className="w-[7.25rem]" aria-label="Reasoning depth">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
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
            </div>
          </div>
        </CardContent>
      </Card>

      <TelegramSettingsCard />

      <Card className="w-full">
        <CardContent className="p-0">
          {!isConfigured ? (
            <>
              <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-200" aria-hidden="true" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-amber-100">No provider connected</p>
                  <p className="text-xs text-amber-200/90">
                    Chat is offline until you add an API key below.
                  </p>
                </div>
              </div>
              <div className="px-4 py-4">
                <ProviderSetupForm
                  onSuccess={() => {
                    setSuccessMessage("Provider connected.");
                  }}
                />
              </div>
            </>
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

      {isConfigured && models?.provider ? (
        <Card className="w-full">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle>Switch provider</CardTitle>
            <CardDescription>
              Currently on {formatProviderLabel(models.provider)}. Chat history resets when you
              change providers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <SwitchProviderSection
              currentProvider={models.provider as SelectedProvider}
              catalog={catalog}
              configureProvider={configureProvider}
              onSuccess={(message) => {
                setSuccessMessage(message);
                setFormError(null);
              }}
            />
          </CardContent>
        </Card>
      ) : null}
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
    setTargetProvider((current: SelectedProvider) =>
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
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <ProviderSelect
          id="switch-provider"
          selectedProvider={targetProvider}
          density="compact"
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

        <FormField id="switch-model" label="Model" density="compact">
          <Select
            value={selectedModel}
            disabled={busy || targetModels.length === 0}
            onValueChange={(value) => setSelectedModel(value != null ? String(value) : "")}
          >
            <SelectTrigger id="switch-model" className="w-full">
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
        </FormField>
      </div>

      <FormField
        id="switch-api-key"
        label="API key"
        density="compact"
        footer={
          apiKeyError ? (
            <p id="switch-api-key-error" className="text-sm text-destructive" role="alert">
              {apiKeyError}
            </p>
          ) : null
        }
      >
        <InputGroup>
          <InputGroupInput
            id="switch-api-key"
            type={showApiKey ? "text" : "password"}
            autoComplete="off"
            placeholder={apiKeyPlaceholder(targetProvider)}
            value={apiKey}
            disabled={busy}
            aria-invalid={apiKeyError != null}
            aria-describedby={apiKeyError ? "switch-api-key-error" : undefined}
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
      </FormField>

      {targetProvider === "openrouter" ? (
        <FormField
          id="switch-custom-model"
          density="compact"
          label={
            <>
              Custom model ID <span className="font-normal text-muted-foreground">(optional)</span>
            </>
          }
          footer={
            customModelError ? (
              <p id="switch-custom-model-error" className="text-sm text-destructive" role="alert">
                {customModelError}
              </p>
            ) : (
              <p id="switch-custom-model-hint" className="text-xs text-muted-foreground">
                Overrides the catalog selection when set.
              </p>
            )
          }
        >
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
        </FormField>
      ) : null}

      {localError ? (
        <p className="text-sm text-destructive" role="alert">
          {localError}
        </p>
      ) : null}

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
    </form>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <div className="text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
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
  const currentModelName =
    configuredModels.find((model) => model.id === models.currentModel)?.name ??
    models.currentModel;

  return (
    <div className="divide-y divide-border">
      <div className="px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">Provider</p>
          <p className="text-xs text-muted-foreground">
            {formatProviderLabel(currentProvider)} · {currentModelName}
          </p>
        </div>
      </div>

      <SettingsRow
        label="Model"
        description={
          modelSaveHint ? (
            <span className="text-emerald-200" role="status">
              {modelSaveHint}
            </span>
          ) : (
            "Chat history resets when you change models"
          )
        }
      >
        <div className="flex items-center gap-2">
          <Select
            value={modelDraft}
            disabled={modelBusy || configuredModels.length === 0}
            onValueChange={(value) => onModelDraftChange(value != null ? String(value) : "")}
          >
            <SelectTrigger id="connected-model" className="w-[11rem] sm:w-[13rem]">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent align="end">
              {configuredModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                  {model.default ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={modelBusy || !modelDraft || !modelDirty}
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
        </div>
      </SettingsRow>

      <SettingsRow label="API key" description="Saved on the server">
        <Button type="button" size="sm" variant="outline" onClick={onOpenReplaceKey}>
          Replace key
        </Button>
      </SettingsRow>

      <Dialog
        open={replaceKeyOpen}
        onOpenChange={(open) => {
          if (!open) {
            onCancelReplaceKey();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={onSubmitReplaceKey}>
            <DialogHeader>
              <DialogTitle>Replace API key</DialogTitle>
              <DialogDescription>
                Paste a new key from your {formatProviderLabel(currentProvider)} dashboard. The
                current model stays the same.
              </DialogDescription>
            </DialogHeader>

            <InputGroup>
              <InputGroupInput
                id="replace-api-key"
                type={showApiKey ? "text" : "password"}
                autoComplete="off"
                placeholder={apiKeyPlaceholder(currentProvider)}
                value={apiKey}
                disabled={replaceKeyBusy}
                aria-invalid={apiKeyError != null}
                aria-describedby={apiKeyError ? "replace-api-key-error" : undefined}
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
            ) : null}
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={replaceKeyBusy}
                onClick={onCancelReplaceKey}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={replaceKeyBusy || !apiKey.trim()}>
                {replaceKeyBusy ? (
                  <>
                    <Spinner className="mr-2" />
                    Saving…
                  </>
                ) : (
                  "Save key"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
