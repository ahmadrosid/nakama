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

/** Saved model that turns image generation off (server: IMAGE_GENERATION_OFF). */
const IMAGE_GENERATION_OFF_VALUE = "off";

interface ImageGenerationChoice {
  label: string;
  value: string;
}

interface ImageGenerationProviderSummary {
  hasApiKey: boolean;
  id: string;
  type: string;
}

/**
 * The picker's choices and labels. Every ChatGPT model makes images with the
 * same hosted tool, so each signed-in ChatGPT account is one choice, not one
 * per chat model; with a single account, the unset default already covers it.
 */
function imageGenerationChoices(
  models: Parameters<typeof groupModelsByProvider>[0],
  providers: ImageGenerationProviderSummary[],
  selection: string
) {
  const groups = groupModelsByProvider(models);

  // The catalog lists ChatGPT models even when no ChatGPT is signed in, so
  // only providers the server reports as connected count.
  const connectedChatgptIds = new Set(
    providers.flatMap((provider) =>
      provider.type === "chatgpt" && provider.hasApiKey ? [provider.id] : []
    )
  );

  const chatgptGroups = groups.filter(
    (group) =>
      connectedChatgptIds.has(group.providerId) &&
      group.models.some((model) => model.provider === "chatgpt")
  );

  const openaiAvailable = groups.some((group) =>
    group.models.some((model) => model.provider === "openai")
  );

  // Any custom model on an OpenAI-compatible provider may speak the Images
  // API; the server posts the one picked to `<baseUrl>/images/generations`.
  const compatibleGroups = groups.filter((group) =>
    group.models.some((model) => model.provider === "openai_compatible")
  );

  const labelGroups = [
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
    ...compatibleGroups,
  ];

  // With nothing saved, the server makes images with a connected ChatGPT.
  const chatgptAvailable = chatgptGroups.length > 0;
  const providerAvailable = chatgptAvailable || labelGroups.length > 0;
  const unsetLabel = chatgptAvailable ? "ChatGPT (default)" : "Not configured";

  const chatgptGroupOf = (model: string) =>
    chatgptGroups.find((group) => model.startsWith(`${group.providerId}::`));

  const choices: ImageGenerationChoice[] = [
    { label: unsetLabel, value: CLEAR_IMAGE_GENERATION_MODEL_VALUE },
    ...(chatgptGroups.length > 1
      ? chatgptGroups.map((group) => ({
          label: group.providerLabel,
          // A saved ChatGPT pick keeps its own value, so it shows selected.
          value:
            chatgptGroupOf(selection) === group
              ? selection
              : encodeModelSelection(
                  group.providerId,
                  (
                    group.models.find((model) => model.default) ??
                    group.models[0]
                  ).id
                ),
        }))
      : []),
    ...(openaiAvailable
      ? [
          {
            label: `OpenAI: ${IMAGE_GENERATION_MODEL_OPTIONS[0].name}`,
            value: IMAGE_GENERATION_SELECTION,
          },
        ]
      : []),
    ...compatibleGroups.flatMap((group) =>
      group.models.map((model) => ({
        label: `${group.providerLabel}: ${model.name}`,
        value: encodeModelSelection(group.providerId, model.id),
      }))
    ),
    ...(chatgptAvailable
      ? [{ label: "Off", value: IMAGE_GENERATION_OFF_VALUE }]
      : []),
  ];

  const labelOf = (model: string | null) => {
    if (!model) {
      return providerAvailable ? unsetLabel : "No image provider";
    }

    if (model === IMAGE_GENERATION_OFF_VALUE) {
      return "Off";
    }

    return (
      chatgptGroupOf(model)?.providerLabel ??
      profileModelLabel(model, labelGroups)
    );
  };

  return { choices, labelOf, providerAvailable };
}

export function ImageGenerationSettingsCard() {
  const [formError, setFormError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string>("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const { data: modelsResponse } = useModelsQuery();
  const { data: imageGenerationSettings } = useImageGenerationSettings();
  const saveImageGenerationMutation = useSaveImageGenerationSettings();

  const { choices, labelOf, providerAvailable } = useMemo(
    () =>
      imageGenerationChoices(
        modelsResponse?.models ?? [],
        modelsResponse?.providers ?? [],
        selection
      ),
    [modelsResponse?.models, modelsResponse?.providers, selection]
  );

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
      title="Image generation"
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
              setSavedHint(`Saved · ${labelOf(saved.model)}`);
            },
          });
        }}
        value={selection || CLEAR_IMAGE_GENERATION_MODEL_VALUE}
      >
        <SelectTrigger aria-label="Image generation" className="h-9 w-full">
          <SelectValue placeholder="Select image generation model">
            {labelOf(selection)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          className="w-max min-w-72 max-w-[min(24rem,92vw)]"
        >
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsModelTile>
  );
}
