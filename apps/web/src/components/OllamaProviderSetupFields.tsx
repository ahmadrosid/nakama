import type { OllamaHostMode } from "@nakama/core/contract";
import {
  OLLAMA_CLOUD_DEFAULT_BASE_URL,
  OLLAMA_LOCAL_DEFAULT_BASE_URL,
} from "@nakama/core/ollama-provider-config";
import { Button } from "@nakama/ui/button";
import { FormField } from "@nakama/ui/form-field";
import { InputGroup, InputGroupInput } from "@nakama/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useState } from "react";

interface OllamaProviderSetupFieldsProps {
  baseUrl: string;
  baseUrlError?: string | null;
  density?: "default" | "compact";
  disabled?: boolean;
  fieldIdPrefix?: string;
  hostMode: OllamaHostMode;
  onBaseUrlChange: (baseUrl: string) => void;
  onHostModeChange: (hostMode: OllamaHostMode) => void;
}

function defaultBaseUrl(hostMode: OllamaHostMode): string {
  return hostMode === "cloud"
    ? OLLAMA_CLOUD_DEFAULT_BASE_URL
    : OLLAMA_LOCAL_DEFAULT_BASE_URL;
}

export function OllamaProviderSetupFields({
  hostMode,
  baseUrl,
  disabled,
  density = "default",
  baseUrlError,
  fieldIdPrefix = "ollama",
  onHostModeChange,
  onBaseUrlChange,
}: OllamaProviderSetupFieldsProps) {
  const hostModeId = `${fieldIdPrefix}-host-mode`;
  const baseUrlId = `${fieldIdPrefix}-base-url`;

  // The host choice sets the address; the field opens only for another one.
  const [editingAddress, setEditingAddress] = useState(
    () => baseUrl.trim() !== "" && baseUrl.trim() !== defaultBaseUrl(hostMode)
  );

  const showAddressField = editingAddress || baseUrlError != null;

  return (
    <div className="space-y-4">
      <FormField density={density} id={hostModeId} label="Where Ollama runs">
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            const nextMode = value === "cloud" ? "cloud" : "local";
            onHostModeChange(nextMode);
            onBaseUrlChange(defaultBaseUrl(nextMode));
            setEditingAddress(false);
          }}
          value={hostMode}
        >
          <SelectTrigger className="w-full" id={hostModeId}>
            <SelectValue>
              {hostMode === "cloud" ? "Ollama Cloud" : "This computer"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">This computer</SelectItem>
            <SelectItem value="cloud">Ollama Cloud</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      {showAddressField ? (
        <FormField
          density={density}
          footer={
            baseUrlError ? (
              <p className="text-destructive text-sm" role="alert">
                {baseUrlError}
              </p>
            ) : null
          }
          id={baseUrlId}
          label="Address"
        >
          <InputGroup>
            <InputGroupInput
              aria-invalid={baseUrlError != null}
              disabled={disabled}
              id={baseUrlId}
              inputMode="url"
              onChange={(event) => onBaseUrlChange(event.target.value)}
              value={baseUrl}
            />
          </InputGroup>
        </FormField>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
            {baseUrl}
          </span>
          <Button
            disabled={disabled}
            onClick={() => setEditingAddress(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Change address
          </Button>
        </div>
      )}
    </div>
  );
}
