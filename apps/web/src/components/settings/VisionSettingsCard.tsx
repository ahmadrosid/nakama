import { useEffect, useMemo, useState } from "react";
import { SettingsModelTile } from "@/components/settings/settings-model-tile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelsQuery } from "@/hooks/use-app-queries";
import {
  useSaveVisionSettings,
  useVisionSettings,
} from "@/hooks/use-vision-settings";
import { formatError } from "@/lib/client";
import {
  encodeModelSelection,
  groupModelsByProvider,
  profileModelLabel,
  profileModelSelectionValue,
  resolveModelVisionSupport,
} from "@/lib/models";

const CLEAR_VISION_MODEL_VALUE = "__vision_unset__";

export function VisionSettingsCard() {
  const [formError, setFormError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string>("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const { data: modelsResponse } = useModelsQuery();
  const { data: visionSettings } = useVisionSettings();
  const saveVisionMutation = useSaveVisionSettings();

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(modelsResponse?.models ?? []),
    [modelsResponse?.models]
  );

  const visionModelGroups = useMemo(() => {
    const groups: typeof providerModelGroups = [];

    for (const group of providerModelGroups) {
      const models = group.models.filter(
        (model) =>
          resolveModelVisionSupport(
            encodeModelSelection(group.providerId, model.id),
            providerModelGroups
          ) === true
      );

      if (models.length > 0) {
        groups.push({ ...group, models });
      }
    }

    return groups;
  }, [providerModelGroups]);

  const visionUnavailable = visionModelGroups.length === 0;

  const selectionValue = useMemo(() => {
    if (!selection) {
      return CLEAR_VISION_MODEL_VALUE;
    }

    return (
      profileModelSelectionValue(selection, visionModelGroups) ||
      CLEAR_VISION_MODEL_VALUE
    );
  }, [selection, visionModelGroups]);

  useEffect(() => {
    setSelection(visionSettings?.model ?? "");
  }, [visionSettings?.model]);

  useEffect(() => {
    if (!savedHint) {
      return;
    }

    const timeout = window.setTimeout(() => setSavedHint(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [savedHint]);

  return (
    <SettingsModelTile
      footer={
        savedHint || formError ? (
          <>
            {savedHint ? (
              <p
                className="text-emerald-700 text-xs dark:text-emerald-300"
                role="status"
              >
                {savedHint}
              </p>
            ) : null}
            {formError ? (
              <p className="text-destructive text-xs" role="alert">
                {formError}
              </p>
            ) : null}
          </>
        ) : undefined
      }
      title="Image parsing model"
    >
      <Select
        disabled={saveVisionMutation.isPending || visionUnavailable}
        onValueChange={(value) => {
          if (!value) {
            return;
          }

          const model =
            value === CLEAR_VISION_MODEL_VALUE ? null : String(value);

          if (
            model &&
            resolveModelVisionSupport(model, providerModelGroups) !== true
          ) {
            setFormError("Choose a vision-capable model.");
            return;
          }

          setFormError(null);
          setSelection(model ?? "");
          setSavedHint(null);

          saveVisionMutation.mutate(model, {
            onError: (error) => {
              setSelection(visionSettings?.model ?? "");
              setFormError(formatError(error));
            },
            onSuccess: (saved) => {
              setSelection(saved.model ?? "");
              setSavedHint(
                saved.model
                  ? `Saved · ${profileModelLabel(saved.model, visionModelGroups)}`
                  : "Cleared"
              );
            },
          });
        }}
        value={selectionValue}
      >
        <SelectTrigger aria-label="Image parsing model" className="h-9 w-full">
          <SelectValue placeholder="Select vision model">
            {selection
              ? profileModelLabel(selection, visionModelGroups)
              : visionUnavailable
                ? "No vision providers"
                : "Not configured"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          className="w-max min-w-72 max-w-[min(24rem,92vw)]"
        >
          <SelectItem value={CLEAR_VISION_MODEL_VALUE}>
            Not configured
          </SelectItem>
          {visionModelGroups.flatMap((group) =>
            group.models.map((model) => (
              <SelectItem
                key={`${group.providerId}:${model.id}`}
                value={encodeModelSelection(group.providerId, model.id)}
              >
                {group.providerLabel}: {model.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </SettingsModelTile>
  );
}
