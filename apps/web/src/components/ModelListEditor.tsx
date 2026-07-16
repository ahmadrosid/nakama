import type { CustomModelEntry } from "@nakama/core/contract";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";

export interface ModelListRow extends CustomModelEntry {}

interface ModelListEditorProps {
  models: ModelListRow[];
  disabled?: boolean;
  showPricing?: boolean;
  showThinkingToggle?: boolean;
  onBrowse?: () => void;
  browseLabel?: string;
  onChange: (models: ModelListRow[]) => void;
}

function emptyRow(): ModelListRow {
  return { id: "", name: "" };
}

export function ModelListEditor({
  models,
  disabled,
  showPricing = true,
  showThinkingToggle = false,
  onBrowse,
  browseLabel = "Browse models.dev",
  onChange,
}: ModelListEditorProps) {
  const updateRow = (index: number, patch: Partial<ModelListRow>) => {
    onChange(
      models.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const removeRow = (index: number) => {
    onChange(models.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Model ID</th>
              <th className="px-2 py-2 font-medium">Display name</th>
              {showPricing ? (
                <>
                  <th className="px-2 py-2 font-medium">$/1M in</th>
                  <th className="px-2 py-2 font-medium">$/1M out</th>
                </>
              ) : null}
              {showThinkingToggle ? (
                <th className="px-2 py-2 font-medium">Thinking</th>
              ) : null}
              <th className="px-2 py-2 w-10" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {models.map((row, index) => (
              <tr key={`model-row-${index}`} className="border-b border-border/60 last:border-0">
                <td className="px-2 py-1.5">
                  <InputGroup>
                    <InputGroupInput
                      value={row.id}
                      disabled={disabled}
                      placeholder="llama3.2"
                      onChange={(event) =>
                        updateRow(index, { id: event.target.value })
                      }
                    />
                  </InputGroup>
                </td>
                <td className="px-2 py-1.5">
                  <InputGroup>
                    <InputGroupInput
                      value={row.name ?? ""}
                      disabled={disabled}
                      placeholder="Optional label"
                      onChange={(event) =>
                        updateRow(index, { name: event.target.value })
                      }
                    />
                  </InputGroup>
                </td>
                {showPricing ? (
                  <>
                    <td className="px-2 py-1.5">
                      <InputGroup>
                        <InputGroupInput
                          type="number"
                          min={0}
                          step="any"
                          value={row.inputPerMillionUsd ?? ""}
                          disabled={disabled}
                          placeholder="—"
                          onChange={(event) => {
                            const value = event.target.value;
                            updateRow(index, {
                              inputPerMillionUsd:
                                value === "" ? undefined : Number(value),
                            });
                          }}
                        />
                      </InputGroup>
                    </td>
                    <td className="px-2 py-1.5">
                      <InputGroup>
                        <InputGroupInput
                          type="number"
                          min={0}
                          step="any"
                          value={row.outputPerMillionUsd ?? ""}
                          disabled={disabled}
                          placeholder="—"
                          onChange={(event) => {
                            const value = event.target.value;
                            updateRow(index, {
                              outputPerMillionUsd:
                                value === "" ? undefined : Number(value),
                            });
                          }}
                        />
                      </InputGroup>
                    </td>
                  </>
                ) : null}
                {showThinkingToggle ? (
                  <td className="px-2 py-1.5">
                    <div className="flex justify-center">
                      <Switch
                        checked={row.supportsThinking === true}
                        disabled={disabled}
                        aria-label={`Enable thinking for ${row.id || row.name || `model ${index + 1}`}`}
                        onCheckedChange={(checked) =>
                          updateRow(index, { supportsThinking: checked })
                        }
                      />
                    </div>
                  </td>
                ) : null}
                <td className="px-2 py-1.5 text-right">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || models.length <= 1}
                    aria-label="Remove model"
                    onClick={() => removeRow(index)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...models, emptyRow()])}
        >
          <PlusIcon className="mr-1 size-4" />
          Add model
        </Button>

        {onBrowse ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={onBrowse}
          >
            {browseLabel}
          </Button>
        ) : null}
      </div>

      {showPricing ? (
        <p className="text-xs text-muted-foreground">
          Leave pricing blank to track tokens without estimating cost.
        </p>
      ) : null}
    </div>
  );
}
