import type { CustomModelEntry } from "@nakama/core/contract";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { createClientId, syncRowKeys } from "@/lib/client-id";

export interface ModelListRow extends CustomModelEntry {}

interface ModelListEditorProps {
  browseLabel?: string;
  disabled?: boolean;
  models: ModelListRow[];
  onBrowse?: () => void;
  onChange: (models: ModelListRow[]) => void;
  showPricing?: boolean;
  showThinking?: boolean;
}

function emptyRow(): ModelListRow {
  return { id: "", name: "" };
}

export function ModelListEditor({
  models,
  disabled,
  showPricing = true,
  showThinking = false,
  onBrowse,
  browseLabel = "Browse models.dev",
  onChange,
}: ModelListEditorProps) {
  const rowKeysRef = useRef<string[]>([]);
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

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className={`w-full text-left text-xs ${showThinking ? "min-w-[40rem]" : "min-w-[32rem]"}`}
        >
          <thead className="border-border border-b bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Model ID</th>
              <th className="px-2 py-2 font-medium">Display name</th>
              {showThinking ? (
                <th className="px-2 py-2 font-medium">Reasoning</th>
              ) : null}
              {showPricing ? (
                <>
                  <th className="px-2 py-2 font-medium">$/1M in</th>
                  <th className="px-2 py-2 font-medium">$/1M out</th>
                </>
              ) : null}
              <th aria-label="Actions" className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {models.map((row, index) => (
              <tr
                className="border-border/60 border-b last:border-0"
                key={row.id.trim() || rowKeysRef.current[index]}
              >
                <td className="px-2 py-1.5">
                  <InputGroup>
                    <InputGroupInput
                      disabled={disabled}
                      onChange={(event) =>
                        updateRow(index, { id: event.target.value })
                      }
                      placeholder="llama3.2"
                      value={row.id}
                    />
                  </InputGroup>
                </td>
                <td className="px-2 py-1.5">
                  <InputGroup>
                    <InputGroupInput
                      disabled={disabled}
                      onChange={(event) =>
                        updateRow(index, { name: event.target.value })
                      }
                      placeholder="Optional label"
                      value={row.name ?? ""}
                    />
                  </InputGroup>
                </td>
                {showThinking ? (
                  <td className="px-2 py-1.5">
                    <Switch
                      aria-label={`Reasoning for ${row.id.trim() || "model"}`}
                      checked={row.supportsThinking === true}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        updateRow(index, { supportsThinking: checked })
                      }
                      size="sm"
                    />
                  </td>
                ) : null}
                {showPricing ? (
                  <>
                    <td className="px-2 py-1.5">
                      <InputGroup>
                        <InputGroupInput
                          disabled={disabled}
                          min={0}
                          onChange={(event) => {
                            const value = event.target.value;
                            updateRow(index, {
                              inputPerMillionUsd:
                                value === "" ? undefined : Number(value),
                            });
                          }}
                          placeholder="—"
                          step="any"
                          type="number"
                          value={row.inputPerMillionUsd ?? ""}
                        />
                      </InputGroup>
                    </td>
                    <td className="px-2 py-1.5">
                      <InputGroup>
                        <InputGroupInput
                          disabled={disabled}
                          min={0}
                          onChange={(event) => {
                            const value = event.target.value;
                            updateRow(index, {
                              outputPerMillionUsd:
                                value === "" ? undefined : Number(value),
                            });
                          }}
                          placeholder="—"
                          step="any"
                          type="number"
                          value={row.outputPerMillionUsd ?? ""}
                        />
                      </InputGroup>
                    </td>
                  </>
                ) : null}
                <td className="px-2 py-1.5 text-right">
                  <Button
                    aria-label="Remove model"
                    disabled={disabled || models.length <= 1}
                    onClick={() => removeRow(index)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
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
          disabled={disabled}
          onClick={() => {
            rowKeysRef.current.push(createClientId());
            onChange([...models, emptyRow()]);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon className="mr-1 size-4" />
          Add model
        </Button>

        {onBrowse ? (
          <Button
            disabled={disabled}
            onClick={onBrowse}
            size="sm"
            type="button"
            variant="secondary"
          >
            {browseLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
