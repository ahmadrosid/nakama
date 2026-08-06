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
  hostMode: OllamaHostMode;
  baseUrl: string;
  disabled?: boolean;
  density?: "default" | "compact";
  baseUrlError?: string | null;
  fieldIdPrefix?: string;
  onHostModeChange: (hostMode: OllamaHostMode) => void;
  onBaseUrlChange: (baseUrl: string) => void;
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
      <FormField id={hostModeId} label="Host" density={density}>
        <Select
          value={hostMode}
          disabled={disabled}
          onValueChange={(value) => {
            const nextMode = value === "cloud" ? "cloud" : "local";
            onHostModeChange(nextMode);
            onBaseUrlChange(
              nextMode === "cloud"
                ? OLLAMA_CLOUD_DEFAULT_BASE_URL
                : OLLAMA_LOCAL_DEFAULT_BASE_URL,
            );
          }}
        >
          <SelectTrigger id={hostModeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local (localhost:11434)</SelectItem>
            <SelectItem value="cloud">Ollama Cloud</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id={baseUrlId}
        label="Base URL"
        density={density}
        footer={
          baseUrlError ? (
            <p className="text-sm text-destructive" role="alert">
              {baseUrlError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              OpenAI-compatible endpoint. Local defaults to{" "}
              <span className="font-mono">{OLLAMA_LOCAL_DEFAULT_BASE_URL}</span>.
            </p>
          )
        }
      >
        <InputGroup>
          <InputGroupInput
            id={baseUrlId}
            value={baseUrl}
            disabled={disabled}
            aria-invalid={baseUrlError != null}
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
        </InputGroup>
      </FormField>
    </div>
  );
}
