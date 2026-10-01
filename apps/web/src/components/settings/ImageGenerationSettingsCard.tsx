import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useEffect, useMemo, useState } from "react";
import { SettingsModelTile } from "@/components/settings/settings-model-tile";
import {
  useImageGenerationSettings,
  useModelsQuery,
  useSaveImageGenerationSettings,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  encodeModelSelection,
  groupModelsByProvider,
  IMAGE_GENERATION_MODEL_OPTIONS,
  IMAGE_GENERATION_SELECTION,
  profileModelLabel,
} from "@/lib/models";

const CLEAR_IMAGE_GENERATION_MODEL_VALUE = "__image_generation_unset__";

export function ImageGenerationSettingsCard() {
  const [formError, setFormError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string>("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const { data: modelsResponse } = useModelsQuery();
  const { data: imageGenerationSettings } = useImageGenerationSettings();
  const saveImageGenerationMutation = useSaveImageGenerationSettings();

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(modelsResponse?.models ?? []),
    [modelsResponse?.models]
  );

  const openaiAvailable = useMemo(
    () =>
      providerModelGroups.some((group) =>
        group.models.some((model) => model.provider === "openai")
      ),
    [providerModelGroups]
  );

  // Any custom model on an OpenAI-compatible provider may speak the Images
  // API; the server posts the one picked to `<baseUrl>/images/generations`.
  const compatibleModelGroups = useMemo(
    () =>
      providerModelGroups.filter((group) =>
        group.models.some((model) => model.provider === "openai_compatible")
      ),
    [providerModelGroups]
  );

  const imageModelGroups = useMemo(
    () => [
      ...(openaiAvailable
        ? [
            {
              models: IMAGE_GENERATION_MODEL_OPTIONS.map((option) => ({
                id: option.id,
                name: option.name,
                provider: "openai" as const,
              })),
              providerId: "openai",
              providerLabel: "OpenAI",
            },
          ]
        : []),
      ...compatibleModelGroups,
    ],
    [openaiAvailable, compatibleModelGroups]
  );

  const providerAvailable = imageModelGroups.length > 0;

  const selectionValue = selection || CLEAR_IMAGE_GENERATION_MODEL_VALUE;

  useEffect(() => {
    setSelection(imageGenerationSettings?.model ?? "");
  }, [imageGenerationSettings?.model]);

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
      title="Image generation model"
    >
      <Select
        disabled={saveImageGenerationMutation.isPending || !providerAvailable}
        onValueChange={(value) => {
          if (!value) {
            return;
          }

          const model =
            value === CLEAR_IMAGE_GENERATION_MODEL_VALUE ? null : String(value);

          setFormError(null);
          setSelection(model ?? "");
          setSavedHint(null);

          saveImageGenerationMutation.mutate(model, {
            onError: (error) => {
              setSelection(imageGenerationSettings?.model ?? "");
              setFormError(formatError(error));
            },
            onSuccess: (saved) => {
              setSelection(saved.model ?? "");
              setSavedHint(
                saved.model
                  ? `Saved · ${profileModelLabel(saved.model, imageModelGroups)}`
                  : "Cleared"
              );
            },
          });
        }}
        value={selectionValue}
      >
        <SelectTrigger
          aria-label="Image generation model"
          className="h-9 w-full"
        >
          <SelectValue placeholder="Select image generation model">
            {selection
              ? profileModelLabel(selection, imageModelGroups)
              : providerAvailable
                ? "Not configured"
                : "No image provider"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          className="w-max min-w-72 max-w-[min(24rem,92vw)]"
        >
          <SelectItem value={CLEAR_IMAGE_GENERATION_MODEL_VALUE}>
            Not configured
          </SelectItem>
          {openaiAvailable ? (
            <SelectItem value={IMAGE_GENERATION_SELECTION}>
              OpenAI: {IMAGE_GENERATION_MODEL_OPTIONS[0].name}
            </SelectItem>
          ) : null}
          {compatibleModelGroups.flatMap((group) =>
            group.models.map((model) => (
              <SelectItem
                key={`${group.providerId}::${model.id}`}
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
