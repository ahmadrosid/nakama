import { resolveCloudflareAccountInput } from "@nakama/core/cloudflare-provider-config";
import type { CreateProviderResponse } from "@nakama/core/contract";
import { isDiscoveryModelProvider } from "@nakama/core/discovery-providers";
import { ollamaRequiresApiKey } from "@nakama/core/ollama-provider-config";
import { Button } from "@nakama/ui/button";
import { DialogFooter } from "@nakama/ui/dialog";
import { FormField } from "@nakama/ui/form-field";
import { Input } from "@nakama/ui/input";
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
import { type ReactNode, useState } from "react";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import {
  ChatgptSignInPanel,
  XaiSignInPanel,
} from "@/components/ChatgptSignInPanel";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import {
  type CatalogShortlistProvider,
  isCatalogShortlistProvider,
} from "@/components/catalog-provider-model-fields.shared";
import { DiscoveryProviderModelFields } from "@/components/DiscoveryProviderModelFields";
import { OllamaProviderModelFields } from "@/components/OllamaProviderModelFields";
import { OllamaProviderSetupFields } from "@/components/OllamaProviderSetupFields";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import { ProviderSelect } from "@/components/ProviderSelect";
import { ShortlistBrowseProviderModelFields } from "@/components/ShortlistBrowseProviderModelFields";
import { DiscardChangesConfirm } from "@/components/settings/provider-instance-dialogs";
import { isShortlistBrowseProvider } from "@/components/shortlist-browse-providers.shared";
import { focusModelsField } from "@/hooks/focus-models-field";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import { apiKeyPlaceholder, isLocalBaseUrl } from "@/lib/models";

interface DiscardPrompt {
  onDiscard: () => void;
  onKeep: () => void;
}

interface ProviderSetupFormProps {
  density?: "default" | "compact";
  /** Set while the dialog asks to drop the typed values. */
  discardPrompt?: DiscardPrompt | null;
  /** Setup leaves this off and keeps the provider's default; Settings shows it. */
  /** Inside a dialog: a Cancel button beside the submit, as other dialogs have. */
  onCancel?: () => void;
  showHeading?: boolean;
  showModelPicker?: boolean;
  submitLabel?: string;
}

export function ProviderSetupForm({
  onSuccess,
  ...props
}: ProviderSetupFormProps & {
  onSuccess?: (result: CreateProviderResponse) => void;
}) {
  const form = useProviderSetupForm({ onSuccess });

  return <ProviderSetupFormBody form={form} {...props} />;
}

/** The form for a caller that owns its state, such as a dialog that asks before it drops typed work. */
export function ProviderSetupFormBody({
  form,
  submitLabel = "Save & continue",
  showHeading = true,
  showModelPicker = true,
  density = "default",
  onCancel,
  discardPrompt = null,
}: ProviderSetupFormProps & {
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  const ollamaKeyRequired = ollamaRequiresApiKey(form.ollamaHostMode);

  const apiKeyOptional =
    form.selectedProvider === "openai_compatible" ||
    form.selectedProvider === "chatgpt" ||
    form.selectedProvider === "xai_oauth" ||
    (form.selectedProvider === "ollama" && !ollamaKeyRequired);

  const canConnect =
    form.selectedProvider === "xai_oauth"
      ? Boolean(form.xaiOAuth)
      : form.selectedProvider === "chatgpt"
        ? Boolean(form.chatgptOAuth)
        : apiKeyOptional || form.apiKey.trim().length > 0;

  const formSpacing = density === "compact" ? "space-y-4" : "space-y-5";

  return (
    <form
      className={`min-w-0 ${formSpacing}`}
      onSubmit={(event) => void form.handleSubmit(event)}
    >
      {showHeading ? (
        <div>
          <h3 className="font-medium text-foreground text-sm">
            Connect a provider
          </h3>
        </div>
      ) : null}

      <FormField density={density} id="provider" label="Provider">
        <ProviderSelect
          configuredTypes={form.configuredTypes}
          disabled={form.busy}
          id="provider"
          onValueChange={form.handleProviderSelect}
          value={form.selectedOptionKey}
        />
      </FormField>

      <ProviderSetupDetails
        apiKeyOptional={apiKeyOptional}
        canConnect={canConnect}
        density={density}
        discardPrompt={discardPrompt}
        form={form}
        onCancel={onCancel}
        showModelPicker={showModelPicker}
        submitLabel={submitLabel}
      />
    </form>
  );
}

// The key error, or the result of the live check after leaving the field.
function ApiKeyFieldFooter({
  form,
}: {
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  if (form.apiKeyError) {
    return (
      <p className="text-destructive text-sm" id="api-key-error" role="alert">
        {form.apiKeyError}
      </p>
    );
  }

  if (form.keyCheck?.key !== form.apiKey.trim()) {
    return null;
  }

  return (
    <p
      className={
        form.keyCheck.status === "ok"
          ? "text-emerald-700 text-sm dark:text-emerald-300"
          : "text-muted-foreground text-sm"
      }
      role="status"
    >
      {form.keyCheck.status === "ok" ? "Key works" : "Checking key…"}
    </p>
  );
}

function ProviderSetupApiKeyField({
  apiKeyOptional,
  density,
  form,
}: {
  apiKeyOptional: boolean;
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  const hostedCustomEndpoint =
    form.selectedProvider === "openai_compatible" &&
    !isLocalBaseUrl(form.baseUrl);

  return (
    <FormField
      density={density}
      footer={<ApiKeyFieldFooter form={form} />}
      id="api-key"
      label={
        apiKeyOptional && !hostedCustomEndpoint
          ? "API key (optional)"
          : hostedCustomEndpoint && form.displayName.trim()
            ? `API key for ${form.displayName.trim()}`
            : "API key"
      }
    >
      <InputGroup>
        <InputGroupInput
          aria-describedby={form.apiKeyError ? "api-key-error" : undefined}
          aria-invalid={form.apiKeyError != null}
          autoComplete="off"
          className="!rounded-l-md pl-3"
          disabled={form.busy}
          id="api-key"
          onBlur={form.handleApiKeyBlur}
          onChange={(event) => form.handleApiKeyChange(event.target.value)}
          placeholder={
            hostedCustomEndpoint
              ? "sk-…"
              : apiKeyPlaceholder(form.selectedProvider)
          }
          type={form.showApiKey ? "text" : "password"}
          value={form.apiKey}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={form.showApiKey ? "Hide API key" : "Show API key"}
            onClick={() => form.setShowApiKey((current) => !current)}
            size="icon-sm"
          >
            {form.showApiKey ? <ViewOffIcon /> : <ViewIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FormField>
  );
}

function CloudflareAccountIdField({
  density,
  form,
}: {
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  return (
    <FormField
      density={density}
      footer={
        form.baseUrlError ? (
          <p
            className="text-destructive text-sm"
            id="cloudflare-account-id-error"
            role="alert"
          >
            {form.baseUrlError}
          </p>
        ) : null
      }
      id="cloudflare-account-id"
      label="Account ID"
    >
      <Input
        aria-invalid={form.baseUrlError != null}
        autoComplete="off"
        disabled={form.busy}
        id="cloudflare-account-id"
        onChange={(event) => form.handleBaseUrlChange(event.target.value)}
        value={form.baseUrl}
      />
    </FormField>
  );
}

function OpenRouterModelFields({
  density,
  form,
}: {
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  return (
    <OpenRouterProviderModelFields
      customModels={form.openRouterModels}
      density={density}
      disabled={form.busy}
      modelsError={form.openRouterModelsError}
      onCustomModelsChange={form.handleOpenRouterModelsChange}
      onRoutingChange={form.setOpenRouterRouting}
      routing={form.openRouterRouting}
    />
  );
}

function OllamaSetupFields({
  canConnect,
  density,
  form,
  keyField,
}: {
  canConnect: boolean;
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
  keyField: ReactNode;
}) {
  return (
    <>
      <OllamaProviderSetupFields
        baseUrl={form.baseUrl}
        baseUrlError={form.baseUrlError}
        density={density}
        disabled={form.busy}
        hostMode={form.ollamaHostMode}
        onBaseUrlChange={form.handleBaseUrlChange}
        onHostModeChange={form.handleOllamaHostModeChange}
      />
      {keyField}
      {canConnect ? (
        <OllamaProviderModelFields
          apiKey={form.apiKey}
          baseUrl={form.baseUrl}
          customModels={form.customModels}
          density={density}
          disabled={form.busy}
          hostMode={form.ollamaHostMode}
          modelsError={form.modelsError}
          onCustomModelsChange={form.handleCustomModelsChange}
        />
      ) : null}
    </>
  );
}

function ShortlistModelFields({
  canConnect,
  density,
  form,
}: {
  canConnect: boolean;
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  if (!(canConnect && isShortlistBrowseProvider(form.selectedProvider))) {
    return null;
  }

  return (
    <ShortlistBrowseProviderModelFields
      apiKey={
        form.selectedProvider === "fireworks" ||
        form.selectedProvider === "cloudflare"
          ? form.apiKey
          : undefined
      }
      baseUrl={
        form.selectedProvider === "cloudflare"
          ? (resolveCloudflareAccountInput(form.baseUrl) ?? undefined)
          : undefined
      }
      customModels={form.shortlistModels}
      density={density}
      disabled={form.busy}
      modelsError={form.shortlistModelsError}
      onCustomModelsChange={form.handleShortlistModelsChange}
      provider={form.selectedProvider}
    />
  );
}

function DefaultModelSelectField({
  density,
  form,
}: {
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  return (
    <FormField density={density} id="model" label="Model">
      <Select
        disabled={form.busy || form.filteredModels.length === 0}
        onValueChange={(value) =>
          form.setSelectedModel(value == null ? "" : String(value))
        }
        value={form.selectedModel}
      >
        <SelectTrigger className="w-full" id="model">
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          {form.filteredModels.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
              {model.default ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

// Most people keep the catalog list, so Add shows one line until asked.
function CatalogModelsStep({
  density,
  form,
  provider,
}: {
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
  provider: CatalogShortlistProvider;
}) {
  const [open, setOpen] = useState(false);
  const rows = form.catalogModelRows;
  const defaultRow = rows.find((row) => row.default) ?? rows[0];

  if (!(open || form.modelsError)) {
    return (
      <FormField density={density} id="catalog-models-edit" label="Models">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <span>
            {rows.length} model{rows.length === 1 ? "" : "s"}
            {defaultRow ? ` · default ${defaultRow.name || defaultRow.id}` : ""}
          </span>
          <Button
            aria-label="Edit models"
            disabled={form.busy}
            id="catalog-models-edit"
            onClick={() => {
              setOpen(true);
              // The button goes away; focus moves into the list it opens.
              setTimeout(focusModelsField, 0);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit models
          </Button>
        </div>
      </FormField>
    );
  }

  return (
    <>
      <CatalogProviderModelFields
        catalogModels={form.filteredModels}
        customModels={rows}
        density={density}
        disabled={form.busy}
        modelsError={form.modelsError}
        onCustomModelsChange={form.handleCatalogModelsChange}
        provider={provider}
      />
      {form.modelsError ? null : (
        <Button
          onClick={() => setOpen(false)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Close model list
        </Button>
      )}
    </>
  );
}

function ProviderSetupExtraFields({
  canConnect,
  density,
  form,
  keyField,
  showModelPicker,
}: {
  canConnect: boolean;
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
  keyField: ReactNode;
  showModelPicker: boolean;
}) {
  if (
    form.selectedProvider !== "openai_compatible" &&
    isDiscoveryModelProvider(form.selectedProvider)
  ) {
    return (
      <DiscoveryProviderModelFields
        canConnect={canConnect}
        density={density}
        form={form}
      />
    );
  }

  if (form.selectedProvider === "cloudflare") {
    return (
      <>
        <CloudflareAccountIdField density={density} form={form} />
        <ShortlistModelFields
          canConnect={canConnect}
          density={density}
          form={form}
        />
      </>
    );
  }

  if (form.selectedProvider === "openai_compatible") {
    return (
      <CustomProviderFields
        apiKey={form.apiKey}
        baseUrl={form.baseUrl}
        baseUrlError={form.baseUrlError}
        customModels={form.customModels}
        density={density}
        disabled={form.busy}
        displayName={form.displayName}
        displayNameError={form.displayNameError}
        keyField={keyField}
        modelsError={form.modelsError}
        onBaseUrlBlur={form.handleBaseUrlBlur}
        onBaseUrlChange={form.handleBaseUrlChange}
        onBaseUrlRequired={form.handleBaseUrlRequired}
        onCustomModelsChange={form.handleCustomModelsChange}
        onDisplayNameChange={form.handleDisplayNameChange}
        onWireApiChange={form.setWireApi}
        showModelsEditor={canConnect}
        wireApi={form.wireApi}
      />
    );
  }

  if (form.selectedProvider === "openrouter") {
    return <OpenRouterModelFields density={density} form={form} />;
  }

  if (form.selectedProvider === "ollama") {
    return (
      <OllamaSetupFields
        canConnect={canConnect}
        density={density}
        form={form}
        keyField={keyField}
      />
    );
  }

  if (isShortlistBrowseProvider(form.selectedProvider)) {
    return (
      <ShortlistModelFields
        canConnect={canConnect}
        density={density}
        form={form}
      />
    );
  }

  if (
    !showModelPicker ||
    ((form.selectedProvider === "chatgpt" ||
      form.selectedProvider === "xai_oauth") &&
      !canConnect)
  ) {
    return null;
  }

  // Same model list as Manage, so a provider picks models one way. A new
  // provider gets a new list, so its catalog IDs stay read-only.
  if (
    form.usesCatalogList &&
    isCatalogShortlistProvider(form.selectedProvider)
  ) {
    return (
      <CatalogModelsStep
        density={density}
        form={form}
        key={form.selectedProvider}
        provider={form.selectedProvider}
      />
    );
  }

  return <DefaultModelSelectField density={density} form={form} />;
}

// Submit stays on: a press with something missing says what, in place.
function ProviderSetupActions({
  busy,
  discardPrompt,
  onCancel,
  primary,
  submitLabel,
}: {
  busy: boolean;
  discardPrompt: DiscardPrompt | null;
  onCancel?: () => void;
  /** False while another step (a sign-in) must come first: no submit yet. */
  primary: boolean;
  submitLabel: string;
}) {
  const submit = primary ? (
    <Button disabled={busy} type="submit">
      {busy ? (
        <>
          <Spinner className="mr-2" />
          Saving…
        </>
      ) : (
        submitLabel
      )}
    </Button>
  ) : null;

  if (!onCancel) {
    return <div className="flex flex-wrap gap-2 pt-1">{submit}</div>;
  }

  if (discardPrompt) {
    return (
      <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
        <DiscardChangesConfirm
          onDiscard={discardPrompt.onDiscard}
          onKeep={discardPrompt.onKeep}
        />
      </DialogFooter>
    );
  }

  return (
    <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
      <Button
        disabled={busy}
        onClick={onCancel}
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
      {submit}
    </DialogFooter>
  );
}

function ProviderSetupDetails({
  apiKeyOptional,
  canConnect,
  density,
  discardPrompt,
  form,
  onCancel,
  showModelPicker,
  submitLabel,
}: {
  apiKeyOptional: boolean;
  canConnect: boolean;
  density: "default" | "compact";
  discardPrompt: DiscardPrompt | null;
  form: ReturnType<typeof useProviderSetupForm>;
  onCancel?: () => void;
  showModelPicker: boolean;
  submitLabel: string;
}) {
  // An endpoint comes before the key that unlocks it.
  const keyAfterEndpoint =
    form.selectedProvider === "openai_compatible" ||
    form.selectedProvider === "ollama";

  const keyField = (
    <ProviderSetupApiKeyField
      apiKeyOptional={apiKeyOptional}
      density={density}
      form={form}
    />
  );

  return (
    <>
      {form.selectedProvider === "xai_oauth" ? (
        <XaiSignInPanel
          density="compact"
          disabled={form.busy}
          oauth={form.xaiOAuth}
          onModelsChange={form.handleSubscriptionModelsChange}
          onOAuthChange={form.setXaiOAuth}
        />
      ) : form.selectedProvider === "chatgpt" ? (
        <ChatgptSignInPanel
          density={density}
          disabled={form.busy}
          oauth={form.chatgptOAuth}
          onModelsChange={form.handleSubscriptionModelsChange}
          onOAuthChange={form.setChatgptOAuth}
        />
      ) : keyAfterEndpoint ? null : (
        keyField
      )}
      <ProviderSetupExtraFields
        canConnect={canConnect}
        density={density}
        form={form}
        keyField={keyAfterEndpoint ? keyField : null}
        showModelPicker={showModelPicker}
      />
      {form.formError ? (
        <p className="text-destructive text-sm" role="alert">
          {form.formError}
        </p>
      ) : null}
      <ProviderSetupActions
        busy={form.busy}
        discardPrompt={discardPrompt}
        onCancel={onCancel}
        primary={
          canConnect ||
          !(
            form.selectedProvider === "chatgpt" ||
            form.selectedProvider === "xai_oauth"
          )
        }
        submitLabel={submitLabel}
      />
    </>
  );
}
