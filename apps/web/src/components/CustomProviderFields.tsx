import type { WireApi } from "@nakama/core/contract";
import { FormField } from "@nakama/ui/form-field";
import { InputGroup, InputGroupInput } from "@nakama/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import type { ReactNode } from "react";
import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import { RemoteModelsBrowseList } from "@/components/RemoteModelsBrowseList";
import { validateBaseUrlInput } from "@/lib/models";

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
  hideIdentity?: boolean;
  hostMode?: "local" | "cloud";
  identityReadOnly?: boolean;
  /** The API key field, placed after the endpoint it unlocks. */
  keyField?: ReactNode;
  modelsError?: string | null;
  onBaseUrlBlur?: () => void;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  onDisplayNameChange: (value: string) => void;
  /** Omitted for endpoints that are known to speak chat/completions, like Ollama. */
  onWireApiChange?: (value: WireApi) => void;
  providerInstanceId?: string;
  remoteProvider?: "ollama" | "openai_compatible" | "netra";
  showModelsEditor?: boolean;
  wireApi?: WireApi;
}

function defaultBrowseLabel(
  remoteProvider: CustomProviderFieldsProps["remoteProvider"]
): string {
  if (remoteProvider === "ollama") {
    return "Ollama";
  }

  return remoteProvider === "netra" ? "Netra" : "endpoint";
}

function sentenceBrowseLabel(label: string): string {
  return label === "endpoint" ? "this endpoint" : label;
}

function FieldError({ message }: { message?: string | null }) {
  return message ? (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  ) : null;
}

function CustomProviderIdentityFields({
  baseUrl,
  baseUrlError,
  density,
  disabled,
  displayName,
  displayNameError,
  onBaseUrlBlur,
  onBaseUrlChange,
  onDisplayNameChange,
  readOnly,
}: {
  baseUrl: string;
  baseUrlError?: string | null;
  density: "default" | "compact";
  disabled?: boolean;
  displayName: string;
  displayNameError?: string | null;
  onBaseUrlBlur?: () => void;
  onBaseUrlChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  readOnly: boolean;
}) {
  return (
    <>
      <FormField
        density={density}
        footer={<FieldError message={displayNameError} />}
        id="provider-display-name"
        label="Provider name"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={displayNameError != null}
            disabled={disabled}
            id="provider-display-name"
            onChange={(event) => onDisplayNameChange(event.target.value)}
            readOnly={readOnly}
            value={displayName}
          />
        </InputGroup>
      </FormField>
      <FormField
        density={density}
        footer={<FieldError message={baseUrlError} />}
        id="provider-base-url"
        label="Base URL"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={baseUrlError != null}
            disabled={disabled}
            id="provider-base-url"
            inputMode="url"
            onBlur={onBaseUrlBlur}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            readOnly={readOnly}
            value={baseUrl}
          />
        </InputGroup>
      </FormField>
    </>
  );
}

export function CustomProviderFields({
  displayName,
  baseUrl,
  apiKey,
  customModels,
  disabled,
  identityReadOnly = false,
  hideIdentity = false,
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
  keyField,
  onDisplayNameChange,
  onBaseUrlBlur,
  onBaseUrlChange,
  onCustomModelsChange,
  onWireApiChange,
}: CustomProviderFieldsProps) {
  const resolvedBrowseLabel = browseLabel ?? defaultBrowseLabel(remoteProvider);

  const canBrowse =
    browseSource !== "remote" ||
    remoteProvider === "netra" ||
    Boolean(providerInstanceId) ||
    validateBaseUrlInput(baseUrl) === null;

  return (
    <div className="space-y-4">
      {hideIdentity ? null : (
        <CustomProviderIdentityFields
          baseUrl={baseUrl}
          baseUrlError={baseUrlError}
          density={density}
          disabled={disabled || identityReadOnly}
          displayName={displayName}
          displayNameError={displayNameError}
          onBaseUrlBlur={onBaseUrlBlur}
          onBaseUrlChange={onBaseUrlChange}
          onDisplayNameChange={onDisplayNameChange}
          readOnly={identityReadOnly}
        />
      )}

      {keyField}

      {onWireApiChange ? (
        <FormField density={density} id="provider-wire-api" label="API format">
          <Select
            disabled={disabled}
            onValueChange={(value) =>
              onWireApiChange(value === "responses" ? "responses" : "chat")
            }
            value={wireApi}
          >
            <SelectTrigger className="w-full" id="provider-wire-api">
              <SelectValue>
                {wireApi === "responses" ? "Responses" : "Chat completions"}
              </SelectValue>
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
          browseLabel="Browse models"
          canBrowse={canBrowse}
          customModels={customModels}
          density={density}
          disabled={disabled}
          fieldId="provider-models"
          modelsError={modelsError}
          onCustomModelsChange={(models) =>
            onCustomModelsChange(
              remoteProvider === "netra"
                ? models.map((model) => ({
                    ...model,
                    supportsThinking: model.supportsThinking ?? true,
                  }))
                : models
            )
          }
          renderBrowse={({ addedIds, multiSelect, onAddMany, onSelect }) =>
            browseSource === "remote" ? (
              <RemoteModelsBrowseList
                addedIds={addedIds}
                apiKey={apiKey}
                baseUrl={baseUrl}
                browseLabel={sentenceBrowseLabel(resolvedBrowseLabel)}
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
          showThinking
          showVision
          toModelRow={(row: ModelListRow) => row}
        />
      ) : null}
    </div>
  );
}
