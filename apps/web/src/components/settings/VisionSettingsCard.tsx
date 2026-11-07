import { toast } from "@nakama/ui/toast";
import { useEffect, useMemo, useState } from "react";
import { SettingsModelSelect } from "@/components/settings/settings-model-select";
import { SettingsModelTile } from "@/components/settings/settings-model-tile";
import {
  useModelsQuery,
  useSaveVisionSettings,
  useVisionSettings,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  encodeModelSelection,
  filterVisionCapableProviderGroups,
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

  const visionModelGroups = useMemo(
    () => filterVisionCapableProviderGroups(providerModelGroups),
    [providerModelGroups]
  );

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
      <SettingsModelSelect
        ariaLabel="Image parsing model"
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

          // A change can be undone from the toast.
          const previous = visionSettings?.model ?? null;

          saveVisionMutation.mutate(model, {
            onError: (error) => {
              setSelection(visionSettings?.model ?? "");
              setFormError(formatError(error));
            },
            onSuccess: (saved) => {
              setSelection(saved.model ?? "");

              if (previous !== (saved.model ?? null)) {
                toast("Image parsing model changed.", 8000, {
                  label: "Undo",
                  onClick: () =>
                    saveVisionMutation.mutate(previous, {
                      onSuccess: (restored) =>
                        setSelection(restored.model ?? ""),
                    }),
                });
              }

              setSavedHint(
                saved.model
                  ? `Saved · ${profileModelLabel(saved.model, visionModelGroups)}`
                  : "Cleared"
              );
            },
          });
        }}
        options={[
          { label: "None", value: CLEAR_VISION_MODEL_VALUE },
          ...visionModelGroups.flatMap((group) =>
            group.models.map((model) => ({
              label: `${model.name} · ${group.providerLabel}`,
              name: model.name,
              provider: { id: group.providerId, label: group.providerLabel },
              value: encodeModelSelection(group.providerId, model.id),
            }))
          ),
          // Models that cannot read images show why they are not a choice.
          ...providerModelGroups.flatMap((group) =>
            group.models
              .filter(
                (model) =>
                  resolveModelVisionSupport(
                    encodeModelSelection(group.providerId, model.id),
                    providerModelGroups
                  ) !== true
              )
              .map((model) => ({
                disabled: true,
                label: `${model.name} · ${group.providerLabel} · cannot read images`,
                name: `${model.name} · cannot read images`,
                provider: { id: group.providerId, label: group.providerLabel },
                value: `no-vision:${encodeModelSelection(group.providerId, model.id)}`,
              }))
          ),
        ]}
        triggerLabel={
          selection
            ? profileModelLabel(selection, visionModelGroups, {
                withProvider: true,
              })
            : visionUnavailable
              ? "No vision providers"
              : "None"
        }
        value={selectionValue}
      />
    </SettingsModelTile>
  );
}
