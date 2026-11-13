import type { ProviderInstanceSummary } from "@nakama/core/contract";
import { toast } from "@nakama/ui/toast";
import { useEffect, useMemo, useState } from "react";
import {
  type SettingsModelOption,
  SettingsModelSelect,
} from "@/components/settings/settings-model-select";
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
  MINIMAX_IMAGE_GENERATION_MODEL_OPTIONS,
  profileModelLabel,
} from "@/lib/models";

const CLEAR_IMAGE_GENERATION_MODEL_VALUE = "__image_generation_unset__";

/** Saved model that turns image generation off (server: IMAGE_GENERATION_OFF). */
const IMAGE_GENERATION_OFF_VALUE = "off";

type ImageGenerationChoice = SettingsModelOption;

type ImageGenerationProviderSummary = Pick<
  ProviderInstanceSummary,
  "chatgptPlanType" | "hasApiKey" | "id" | "label" | "type"
>;

/**
 * The picker's choices and labels. Every ChatGPT model makes images with the
 * same hosted tool, so each signed-in ChatGPT account is one choice, not one
 * per chat model; with a single account, the unset default already covers it.
 */
function imageGenerationChoices(
  models: Parameters<typeof groupModelsByProvider>[0],
  providers: ImageGenerationProviderSummary[],
  selection: string | null
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

  // MiniMax image models are fixed, so a MiniMax provider offers them even
  // with no chat models saved.
  const minimaxGroups = providers.flatMap((provider) =>
    provider.type === "minimax" || provider.type === "minimax_cn"
      ? [
          {
            models: MINIMAX_IMAGE_GENERATION_MODEL_OPTIONS.map((option) => ({
              id: option.id,
              name: option.name,
              provider: provider.type,
            })),
            providerId: provider.id,
            providerLabel: provider.label,
          },
        ]
      : []
  );

  const imageModelGroups = [...compatibleGroups, ...minimaxGroups];

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
    ...imageModelGroups,
  ];

  // With nothing saved, the server makes images with a connected ChatGPT.
  const chatgptAvailable = chatgptGroups.length > 0;
  const providerAvailable = chatgptAvailable || labelGroups.length > 0;
  const unsetLabel = chatgptAvailable ? "Automatic · ChatGPT" : "None";

  const chatgptGroupOf = (model: string) =>
    chatgptGroups.find((group) => model.startsWith(`${group.providerId}::`));

  const choices: ImageGenerationChoice[] = [
    { label: unsetLabel, value: CLEAR_IMAGE_GENERATION_MODEL_VALUE },
    ...(chatgptGroups.length > 1
      ? chatgptGroups.map((group) => ({
          label: group.providerLabel,
          // A saved ChatGPT pick keeps its own value, so it shows selected.
          value:
            selection && chatgptGroupOf(selection) === group
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
            name: IMAGE_GENERATION_MODEL_OPTIONS[0].name,
            provider: { id: "openai", label: "OpenAI" },
            value: IMAGE_GENERATION_SELECTION,
          },
        ]
      : []),
    ...imageModelGroups.flatMap((group) =>
      group.models.map((model) => ({
        label: `${group.providerLabel}: ${model.name}`,
        name: model.name,
        provider: { id: group.providerId, label: group.providerLabel },
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

  const freeChatgptIds = new Set(
    providers.flatMap((provider) =>
      connectedChatgptIds.has(provider.id) &&
      provider.chatgptPlanType === "free"
        ? [provider.id]
        : []
    )
  );

  // ChatGPT Free has no image tool. The automatic pick skips Free accounts, so
  // it only fails when every connected ChatGPT is Free. `null`: not loaded.
  const chatgptFreeNote =
    selection === ""
      ? freeChatgptIds.size > 0 &&
        freeChatgptIds.size === connectedChatgptIds.size
      : selection !== null &&
        freeChatgptIds.has(chatgptGroupOf(selection)?.providerId ?? "");

  return { chatgptFreeNote, choices, labelOf, providerAvailable };
}

export function ImageGenerationSettingsCard() {
  const [formError, setFormError] = useState<string | null>(null);
  // null until the saved model loads, so it does not read as the automatic pick.
  const [selection, setSelection] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const { data: modelsResponse } = useModelsQuery();
  const { data: imageGenerationSettings } = useImageGenerationSettings();
  const saveImageGenerationMutation = useSaveImageGenerationSettings();

  const { chatgptFreeNote, choices, labelOf, providerAvailable } = useMemo(
    () =>
      imageGenerationChoices(
        modelsResponse?.models ?? [],
        modelsResponse?.providers ?? [],
        selection
      ),
    [modelsResponse?.models, modelsResponse?.providers, selection]
  );

  const savedModel = imageGenerationSettings
    ? (imageGenerationSettings.model ?? "")
    : null;

  useEffect(() => {
    if (savedModel !== null) {
      setSelection(savedModel);
    }
  }, [savedModel]);

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
        savedHint || formError || chatgptFreeNote ? (
          <>
            {chatgptFreeNote ? (
              <p className="text-muted-foreground text-xs" role="note">
                ChatGPT Free accounts can't generate images.
              </p>
            ) : null}
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
      <SettingsModelSelect
        ariaLabel="Image generation model"
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

          // A change can be undone from the toast.
          const previous = imageGenerationSettings?.model ?? null;

          saveImageGenerationMutation.mutate(model, {
            onError: (error) => {
              setSelection(imageGenerationSettings?.model ?? "");
              setFormError(formatError(error));
            },
            onSuccess: (saved) => {
              setSelection(saved.model ?? "");

              if (previous !== (saved.model ?? null)) {
                toast("Image generation model changed.", 8000, {
                  label: "Undo",
                  onClick: () =>
                    saveImageGenerationMutation.mutate(previous, {
                      onSuccess: (restored) =>
                        setSelection(restored.model ?? ""),
                    }),
                });
              }

              setSavedHint(`Saved · ${labelOf(saved.model)}`);
            },
          });
        }}
        options={choices}
        triggerLabel={labelOf(selection)}
        value={selection || CLEAR_IMAGE_GENERATION_MODEL_VALUE}
      />
    </SettingsModelTile>
  );
}
