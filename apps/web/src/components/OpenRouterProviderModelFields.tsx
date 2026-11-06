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
      <BrowsableModelFields
        browseLabel="Browse models"
        customModels={customModels}
        density={density}
        disabled={disabled}
        fieldId="openrouter-provider-models"
        modelsError={modelsError}
        onCustomModelsChange={onCustomModelsChange}
        renderBrowse={({ addedIds, multiSelect, onAddMany, onSelect }) => (
          <OpenRouterModelsBrowseList
            addedIds={addedIds}
            className="h-72 rounded-md border border-border"
            multiSelect={multiSelect}
            onAddMany={onAddMany}
            onSelect={onSelect}
          />
        )}
        showThinking
        showVision
        toModelRow={(row: OpenRouterModelRow) => {
          const model: ModelListRow = {
            id: row.id,
            name: row.name,
            supportsThinking: row.reasoning,
            supportsVision: row.vision,
          };

          if (row.inputPerMillionUsd !== undefined) {
            model.inputPerMillionUsd = row.inputPerMillionUsd;
          }

          if (row.outputPerMillionUsd !== undefined) {
            model.outputPerMillionUsd = row.outputPerMillionUsd;
          }

          return model;
        }}
      />
      {/* Routing is optional, so it stays closed until the user needs it. */}
      <details
        className="rounded-lg border border-border px-3 py-2"
        open={Object.values(routing).some((value) => value !== undefined)}
      >
        <summary className="cursor-pointer font-medium text-sm">
          Routing (optional)
        </summary>
        <fieldset className="mt-3 space-y-3" disabled={disabled}>
          <legend className="sr-only">OpenRouter routing</legend>
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
            Stricter routing can fail when no endpoint supports the request.
          </p>
        </fieldset>
      </details>
    </div>
  );
}
