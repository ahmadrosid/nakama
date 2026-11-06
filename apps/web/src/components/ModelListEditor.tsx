import type { CustomModelEntry } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { InputGroup, InputGroupInput } from "@nakama/ui/input-group";
import { Switch } from "@nakama/ui/switch";
import { Add01Icon, Delete02Icon } from "hugeicons-react";
import { useContext, useId, useRef, useState } from "react";
import {
  ModelUsageContext,
  modelListRowVisionEnabled,
} from "@/components/model-list-editor.shared";
import { createClientId, syncRowKeys } from "@/lib/client-id";

export interface ModelListRow extends CustomModelEntry {}

interface ModelListEditorProps {
  browse?: { disabled?: boolean; label: string; onClick: () => void };
  disabled?: boolean;
  models: ModelListRow[];
  onChange: (models: ModelListRow[]) => void;
  showPricing?: boolean;
  showThinking?: boolean;
  showVision?: boolean;
  visionDefaultOn?: boolean;
}

const PRICE_FIELDS = [
  { field: "inputPerMillionUsd", label: "Input $/1M tokens" },
  { field: "cachedInputPerMillionUsd", label: "Cached input $/1M tokens" },
  { field: "outputPerMillionUsd", label: "Output $/1M tokens" },
] as const;

function emptyRow(): ModelListRow {
  return { id: "", name: "" };
}

function parseOptionalNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

export function ModelListEditor({
  models,
  disabled,
  showPricing = true,
  showThinking = false,
  showVision = false,
  visionDefaultOn = false,
  browse,
  onChange,
}: ModelListEditorProps) {
  const rowKeysRef = useRef<string[]>([]);

  // IDs saved before this edit; a row typed now stays editable.
  const [savedIds] = useState<ReadonlySet<string>>(
    () => new Set(models.map((model) => model.id.trim()))
  );

  const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  // Keep React keys available on the first paint (avoids undefined keys + useEffect).
  syncRowKeys(rowKeysRef.current, models.length);

  const updateRow = (index: number, patch: Partial<ModelListRow>) => {
    onChange(
      models.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    );
  };

  const removeRow = (index: number) => {
    rowKeysRef.current.splice(index, 1);
    onChange(models.filter((_, rowIndex) => rowIndex !== index));
  };

  const toggleDetails = (rowKey: string) => {
    setOpenDetails((current) => {
      const next = new Set(current);

      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }

      return next;
    });
  };

  const seenIds = new Set<string>();
  const defaultGroup = useId();
  const usage = useContext(ModelUsageContext);

  // A long list gets a search; short lists do not need one.
  const [query, setQuery] = useState("");
  const needle = models.length > 10 ? query.trim().toLowerCase() : "";

  // With no row marked, the first model with an ID is the default.
  const flaggedDefault = models.findIndex(
    (row) => row.default && row.id.trim()
  );

  const defaultIndex =
    flaggedDefault === -1
      ? models.findIndex((row) => row.id.trim())
      : flaggedDefault;

  const setDefault = (index: number) => {
    onChange(
      models.map((row, rowIndex) => ({ ...row, default: rowIndex === index }))
    );
  };

  return (
    <div className="min-w-0 space-y-2">
      {models.length > 10 ? (
        <InputGroup>
          <InputGroupInput
            aria-label="Search saved models"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved models…"
            value={query}
          />
        </InputGroup>
      ) : null}
      {models.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {models.map((row, index) => {
            const rowKey = rowKeysRef.current[index]!;
            const id = row.id.trim();
            const duplicate = id !== "" && seenIds.has(id);
            seenIds.add(id);
            const label = id || "new model";
            const detailsOpen = openDetails.has(rowKey);
            const detailsId = `model-details-${rowKey}`;

            if (
              needle &&
              !`${row.id} ${row.name ?? ""}`.toLowerCase().includes(needle)
            ) {
              return null;
            }

            const usedBy = usage[id];

            // Saved IDs are fixed; only new rows take an ID.
            const idLocked = id !== "" && savedIds.has(id);

            return (
              <li className="space-y-2 p-2" key={rowKey}>
                <div className="flex flex-wrap items-center gap-2">
                  {idLocked ? (
                    <p
                      className="basis-full truncate px-1 text-muted-foreground text-xs"
                      title={row.id}
                    >
                      <span className="font-mono">{row.id}</span>
                      {usedBy?.length ? (
                        <span> · Used by {usedBy.join(", ")}</span>
                      ) : null}
                    </p>
                  ) : (
                    <InputGroup className="min-w-0 basis-full">
                      <InputGroupInput
                        aria-invalid={duplicate}
                        aria-label={`Model ID ${index + 1}`}
                        className="font-mono text-xs"
                        disabled={disabled}
                        onChange={(event) =>
                          updateRow(index, { id: event.target.value })
                        }
                        placeholder="Model ID"
                        title={row.id}
                        value={row.id}
                      />
                    </InputGroup>
                  )}
                  <InputGroup className="min-w-0 flex-[1_1_12rem]">
                    <InputGroupInput
                      aria-label={`Display name for ${label}`}
                      disabled={disabled}
                      onChange={(event) =>
                        updateRow(index, { name: event.target.value })
                      }
                      placeholder="Display name"
                      value={row.name ?? ""}
                    />
                  </InputGroup>
                  <ModelRowControls
                    canBeDefault={id !== ""}
                    defaultGroup={defaultGroup}
                    detailsId={detailsId}
                    detailsOpen={detailsOpen}
                    disabled={disabled}
                    isDefault={index === defaultIndex}
                    label={label}
                    onChange={(patch) => updateRow(index, patch)}
                    onDefault={() => setDefault(index)}
                    onRemove={() => removeRow(index)}
                    onToggleDetails={() => toggleDetails(rowKey)}
                    row={row}
                    showPricing={showPricing}
                    showThinking={showThinking}
                    showVision={showVision}
                    visionDefaultOn={visionDefaultOn}
                  />
                </div>
                {detailsOpen ? (
                  <ModelRowDetails
                    detailsId={detailsId}
                    disabled={disabled}
                    onChange={(patch) => updateRow(index, patch)}
                    row={row}
                    showPricing={showPricing}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          data-models-add=""
          disabled={disabled}
          onClick={() => {
            rowKeysRef.current.push(createClientId());
            onChange([...models, emptyRow()]);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Add01Icon className="mr-1 size-4" />
          Add model by ID
        </Button>

        {browse ? (
          <Button
            disabled={disabled || browse.disabled}
            onClick={browse.onClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {browse.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ModelRowControls({
  canBeDefault,
  defaultGroup,
  detailsId,
  detailsOpen,
  disabled,
  isDefault,
  label,
  onChange,
  onDefault,
  onRemove,
  onToggleDetails,
  row,
  showPricing,
  showThinking,
  showVision,
  visionDefaultOn,
}: {
  canBeDefault: boolean;
  defaultGroup: string;
  detailsId: string;
  detailsOpen: boolean;
  disabled?: boolean;
  isDefault: boolean;
  label: string;
  onChange: (patch: Partial<ModelListRow>) => void;
  onDefault: () => void;
  onRemove: () => void;
  onToggleDetails: () => void;
  row: ModelListRow;
  showPricing: boolean;
  showThinking: boolean;
  showVision: boolean;
  visionDefaultOn: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs">
        <input
          checked={isDefault}
          className="size-3.5 accent-primary"
          disabled={disabled || !canBeDefault}
          name={defaultGroup}
          onChange={onDefault}
          type="radio"
        />
        Default
      </label>
      {showThinking ? (
        <span className="flex items-center gap-1.5 text-xs">
          <Switch
            aria-label={`Reasoning for ${label}`}
            checked={row.supportsThinking === true}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({ supportsThinking: checked })
            }
            size="sm"
          />
          Reasoning
        </span>
      ) : null}
      {showVision ? (
        <span className="flex items-center gap-1.5 text-xs">
          <Switch
            aria-label={`Vision for ${label}`}
            checked={modelListRowVisionEnabled(row, visionDefaultOn)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ supportsVision: checked })}
            size="sm"
          />
          Vision
        </span>
      ) : null}
      <Button
        aria-controls={detailsId}
        aria-expanded={detailsOpen}
        aria-label={`${showPricing ? "Price and context" : "Context"} for ${label}`}
        disabled={disabled}
        onClick={onToggleDetails}
        size="sm"
        type="button"
        variant="outline"
      >
        <span className="sm:hidden">More</span>
        <span className="hidden sm:inline">
          {showPricing ? "Price and context" : "Context"}
        </span>
      </Button>
      <Button
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={onRemove}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Delete02Icon className="size-4" />
      </Button>
    </div>
  );
}

function ModelRowDetails({
  detailsId,
  disabled,
  onChange,
  row,
  showPricing,
}: {
  detailsId: string;
  disabled?: boolean;
  onChange: (patch: Partial<ModelListRow>) => void;
  row: ModelListRow;
  showPricing: boolean;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
      id={detailsId}
    >
      {showPricing
        ? PRICE_FIELDS.map(({ field, label: fieldLabel }) => (
            <label className="space-y-1 text-xs" key={field}>
              <span className="text-muted-foreground">{fieldLabel}</span>
              <InputGroup>
                <InputGroupInput
                  disabled={disabled}
                  min={0}
                  onChange={(event) =>
                    onChange({
                      [field]: parseOptionalNumber(event.target.value),
                    })
                  }
                  placeholder="Unknown"
                  step="any"
                  type="number"
                  value={row[field] ?? ""}
                />
              </InputGroup>
            </label>
          ))
        : null}
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">Context window (tokens)</span>
        <InputGroup>
          <InputGroupInput
            disabled={disabled}
            min={1}
            onChange={(event) =>
              onChange({
                contextWindow: parseOptionalNumber(event.target.value),
              })
            }
            placeholder="Auto"
            step={1}
            type="number"
            value={row.contextWindow ?? ""}
          />
        </InputGroup>
      </label>
    </div>
  );
}
