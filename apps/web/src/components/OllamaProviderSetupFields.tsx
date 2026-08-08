import type { OllamaHostMode } from "@nakama/core/contract";
import {
  OLLAMA_CLOUD_DEFAULT_BASE_URL,
  OLLAMA_LOCAL_DEFAULT_BASE_URL,
} from "@nakama/core/ollama-provider-config";
import { FormField } from "@/components/ui/form-field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  return (
    <div className="space-y-4">
      <FormField density={density} id={hostModeId} label="Host">
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            const nextMode = value === "cloud" ? "cloud" : "local";
            onHostModeChange(nextMode);
            onBaseUrlChange(
              nextMode === "cloud"
                ? OLLAMA_CLOUD_DEFAULT_BASE_URL
                : OLLAMA_LOCAL_DEFAULT_BASE_URL
            );
          }}
          value={hostMode}
        >
          <SelectTrigger className="w-full" id={hostModeId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local (localhost:11434)</SelectItem>
            <SelectItem value="cloud">Ollama Cloud</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        density={density}
        footer={
          baseUrlError ? (
            <p className="text-destructive text-sm" role="alert">
              {baseUrlError}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              OpenAI-compatible endpoint. Local defaults to{" "}
              <span className="font-mono">{OLLAMA_LOCAL_DEFAULT_BASE_URL}</span>
              .
            </p>
          )
        }
        id={baseUrlId}
        label="Base URL"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={baseUrlError != null}
            disabled={disabled}
            id={baseUrlId}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            value={baseUrl}
          />
        </InputGroup>
      </FormField>
    </div>
  );
}
