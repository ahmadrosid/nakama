import type { WireApi } from "@nakama/core/contract";
import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import { RemoteModelsBrowseList } from "@/components/RemoteModelsBrowseList";
import { FormField } from "@/components/ui/form-field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CustomProviderFieldsProps {
  apiKey: string;
  baseUrl: string;
  baseUrlError?: string | null;
  browseLabel?: string;
  /**
   * `remote` fetches models from the provider endpoint via /v1/models/discover.
   * `models.dev` browses the public models.dev catalog (setup helper for custom endpoints).
   */
  browseSource?: "remote" | "models.dev";
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  displayName: string;
  displayNameError?: string | null;
  hostMode?: "local" | "cloud";
  identityReadOnly?: boolean;
  modelsError?: string | null;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  onDisplayNameChange: (value: string) => void;
  /** Omitted for endpoints that are known to speak chat/completions, like Ollama. */
  onWireApiChange?: (value: WireApi) => void;
  providerInstanceId?: string;
  remoteProvider?: "ollama" | "openai_compatible";
  showModelsEditor?: boolean;
  wireApi?: WireApi;
}

export function CustomProviderFields({
  displayName,
  baseUrl,
  apiKey,
  customModels,
  disabled,
  identityReadOnly = false,
  density = "default",
  showModelsEditor = true,
  displayNameError,
  baseUrlError,
  modelsError,
  browseSource = "remote",
  remoteProvider = "openai_compatible",
  providerInstanceId,
  hostMode,
  browseLabel,
  wireApi = "chat",
  onDisplayNameChange,
  onBaseUrlChange,
  onCustomModelsChange,
  onWireApiChange,
}: CustomProviderFieldsProps) {
  const identityDisabled = disabled || identityReadOnly;
  const resolvedBrowseLabel =
    browseLabel ?? (remoteProvider === "ollama" ? "Ollama" : "this endpoint");

  return (
    <div className="space-y-4">
      <FormField
        density={density}
        footer={
          displayNameError ? (
            <p className="text-destructive text-sm" role="alert">
              {displayNameError}
            </p>
          ) : null
        }
        id="provider-display-name"
        label="Provider name"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={displayNameError != null}
            disabled={identityDisabled}
            id="provider-display-name"
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Ollama"
            readOnly={identityReadOnly}
            value={displayName}
          />
        </InputGroup>
      </FormField>

      <FormField
        density={density}
        footer={
          baseUrlError ? (
            <p className="text-destructive text-sm" role="alert">
              {baseUrlError}
            </p>
          ) : null
        }
        id="provider-base-url"
        label="Base URL"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={baseUrlError != null}
            disabled={identityDisabled}
            id="provider-base-url"
            onChange={(event) => onBaseUrlChange(event.target.value)}
            placeholder="http://localhost:11434/v1"
            readOnly={identityReadOnly}
            value={baseUrl}
          />
        </InputGroup>
      </FormField>

      {onWireApiChange ? (
        <FormField
          density={density}
          footer={
            <p className="text-muted-foreground text-xs">
              Pick Responses only when the endpoint serves{" "}
              <span className="font-mono">/responses</span>. Reasoning survives
              alongside tools there, which chat/completions rejects on newer
              models.
            </p>
          }
          id="provider-wire-api"
          label="API"
        >
          <Select
            disabled={disabled}
            onValueChange={(value) =>
              onWireApiChange(value === "responses" ? "responses" : "chat")
            }
            value={wireApi}
          >
            <SelectTrigger className="w-full" id="provider-wire-api">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chat">Chat completions</SelectItem>
              <SelectItem value="responses">Responses</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      ) : null}

      {showModelsEditor ? (
        <BrowsableModelFields
          browseLabel={
            browseSource === "remote"
              ? `Browse ${resolvedBrowseLabel}`
              : "Browse models.dev"
          }
          customModels={customModels}
          density={density}
          disabled={disabled}
          fieldId="provider-models"
          modelsError={modelsError}
          onCustomModelsChange={onCustomModelsChange}
          renderBrowse={({ multiSelect, onAddMany, onSelect }) =>
            browseSource === "remote" ? (
              <RemoteModelsBrowseList
                apiKey={apiKey}
                baseUrl={baseUrl}
                browseLabel={resolvedBrowseLabel}
                className="h-72 rounded-md border border-border"
                hostMode={hostMode}
                multiSelect={multiSelect}
                onAddMany={onAddMany}
                onSelect={onSelect}
                provider={remoteProvider}
                providerId={providerInstanceId}
              />
            ) : (
              <ModelsBrowseList
                className="h-72 rounded-md border border-border"
                onSelect={(_provider, modelId, row) =>
                  onSelect({
                    id: modelId,
                    name: row.modelName,
                    supportsVision: row.vision,
                  })
                }
              />
            )
          }
          showPricing={false}
          showThinking
          showVision
          toModelRow={(row: ModelListRow) => row}
        />
      ) : null}
    </div>
  );
}
