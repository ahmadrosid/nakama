import type { OpenRouterRoutingSettings } from "@nakama/core/contract";
import { FormField } from "@nakama/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import { OpenRouterModelsBrowseList } from "@/components/OpenRouterModelsBrowseList";
import type { OpenRouterModelRow } from "@/lib/openrouter-models";

interface OpenRouterProviderModelFieldsProps {
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  onRoutingChange: (routing: OpenRouterRoutingSettings) => void;
  routing: OpenRouterRoutingSettings;
}

export function OpenRouterProviderModelFields({
  customModels,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
  onRoutingChange,
  routing,
}: OpenRouterProviderModelFieldsProps) {
  return (
    <div className="space-y-4">
      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="font-medium text-sm">OpenRouter routing</legend>
        {(
          [
            [
              "zdr",
              "Zero data retention (ZDR)",
              "Enforce",
              "No request-level enforcement",
            ],
            [
              "requireParameters",
              "Require all parameters",
              "Require",
              "Do not require",
            ],
          ] as const
        ).map(([key, label, enabled, disabledLabel]) => (
          <FormField
            density={density}
            id={`openrouter-${key}`}
            key={key}
            label={label}
          >
            <Select
              disabled={disabled}
              onValueChange={(value) =>
                onRoutingChange({
                  ...routing,
                  [key]: value === "unset" ? undefined : value === "true",
                })
              }
              value={
                routing[key] === undefined ? "unset" : String(routing[key])
              }
            >
              <SelectTrigger className="w-full" id={`openrouter-${key}`}>
                <SelectValue>
                  {routing[key] === undefined
                    ? "Default (not sent)"
                    : routing[key]
                      ? enabled
                      : disabledLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Default (not sent)</SelectItem>
                <SelectItem value="true">{enabled}</SelectItem>
                <SelectItem value="false">{disabledLabel}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        ))}
        <FormField
          density={density}
          id="openrouter-data-collection"
          label="Data collection policy"
        >
          <Select
            disabled={disabled}
            onValueChange={(value) =>
              onRoutingChange({
                ...routing,
                dataCollection:
                  value === "allow" || value === "deny" ? value : undefined,
              })
            }
            value={routing.dataCollection ?? "unset"}
          >
            <SelectTrigger className="w-full" id="openrouter-data-collection">
              <SelectValue>
                {routing.dataCollection === "deny"
                  ? "Deny"
                  : routing.dataCollection === "allow"
                    ? "Allow"
                    : "Default (not sent)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Default (not sent)</SelectItem>
              <SelectItem value="deny">Deny</SelectItem>
              <SelectItem value="allow">Allow</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <p className="text-muted-foreground text-xs">
          Applies only to this provider’s dedicated OpenRouter model requests.
          Request settings cannot loosen account or guardrail ZDR enforcement.
          These policies do not cover plugins, web tools, application logs, or
          external coding agents. Stricter routing can fail when no eligible
          endpoint supports the request.
        </p>
      </fieldset>
      <BrowsableModelFields
        browseLabel="Browse OpenRouter"
        customModels={customModels}
        density={density}
        disabled={disabled}
        fieldId="openrouter-provider-models"
        modelsError={modelsError}
        onCustomModelsChange={onCustomModelsChange}
        renderBrowse={({ multiSelect, onAddMany, onSelect }) => (
          <OpenRouterModelsBrowseList
            className="h-72 rounded-md border border-border"
            multiSelect={multiSelect}
            onAddMany={onAddMany}
            onSelect={onSelect}
          />
        )}
        showThinking
        showVision
        toModelRow={(row: OpenRouterModelRow) => ({
          id: row.id,
          name: row.name,
          supportsThinking: row.reasoning,
          supportsVision: row.vision,
          ...(row.inputPerMillionUsd === undefined
            ? {}
            : { inputPerMillionUsd: row.inputPerMillionUsd }),
          ...(row.outputPerMillionUsd === undefined
            ? {}
            : { outputPerMillionUsd: row.outputPerMillionUsd }),
        })}
      />
    </div>
  );
}
