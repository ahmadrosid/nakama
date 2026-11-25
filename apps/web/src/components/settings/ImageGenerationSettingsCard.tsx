import type { ProviderInstanceSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { toast } from "@nakama/ui/toast";
import { useEffect, useMemo, useState } from "react";
import { AddProviderDialog } from "@/components/settings/ProviderSettingsCard";
import {
  type SettingsModelOption,
  SettingsModelSelect,
} from "@/components/settings/settings-model-select";
import { SettingsModelTile } from "@/components/settings/settings-model-tile";
import {
  useImageGenerationSettings,
  useModelsQuery,
  useSaveImageGenerationSettings,
  useSaveVideoGenerationSettings,
  useVideoGenerationSettings,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  decodeModelSelection,
  encodeModelSelection,
  groupModelsByProvider,
  IMAGE_GENERATION_MODEL_OPTIONS,
  IMAGE_GENERATION_SELECTION,
  MINIMAX_IMAGE_GENERATION_MODEL_OPTIONS,
  MINIMAX_VIDEO_GENERATION_MODEL_OPTIONS,
  profileModelLabel,
} from "@/lib/models";

const CLEAR_IMAGE_GENERATION_MODEL_VALUE = "__image_generation_unset__";

/** Saved model that turns image generation off (server: IMAGE_GENERATION_OFF). */
const IMAGE_GENERATION_OFF_VALUE = "off";

/** Picks MiniMax before a MiniMax provider exists: opens Add provider. */
const ADD_MINIMAX_VALUE = "__add_minimax__";

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
    ...(minimaxGroups.length === 0
      ? [{ label: "MiniMax", value: ADD_MINIMAX_VALUE }]
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

  return { chatgptFreeNote, choices, labelOf };
}

export function ImageGenerationSettingsCard() {
  const [formError, setFormError] = useState<string | null>(null);
  // null until the saved model loads, so it does not read as the automatic pick.
  const [selection, setSelection] = useState<string | null>(null);

  // The saved model, labelled at render: a provider added just now has no
  // label until the provider list refetches.
  const [savedHint, setSavedHint] = useState<{ model: string | null } | null>(
    null
  );

  const { data: modelsResponse } = useModelsQuery();
  const { data: imageGenerationSettings } = useImageGenerationSettings();
  const saveImageGenerationMutation = useSaveImageGenerationSettings();
  const [addMinimaxOpen, setAddMinimaxOpen] = useState(false);
  // A new key after each close gives the next Add a fresh form.
  const [addFormKey, setAddFormKey] = useState(0);

  const { chatgptFreeNote, choices, labelOf } = useMemo(
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

  const saveModel = (model: string | null) => {
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
                onSuccess: (restored) => setSelection(restored.model ?? ""),
              }),
          });
        }

        setSavedHint({ model: saved.model ?? null });
      },
    });
  };

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
                Saved · {labelOf(savedHint.model)}
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
        disabled={saveImageGenerationMutation.isPending}
        onValueChange={(value) => {
          if (!value) {
            return;
          }

          if (value === ADD_MINIMAX_VALUE) {
            setAddMinimaxOpen(true);

            return;
          }

          saveModel(
            value === CLEAR_IMAGE_GENERATION_MODEL_VALUE ? null : String(value)
          );
        }}
        options={choices}
        triggerLabel={labelOf(selection)}
        value={selection || CLEAR_IMAGE_GENERATION_MODEL_VALUE}
      />
      <AddProviderDialog
        key={addFormKey}
        onAdded={(provider) => {
          // The form lets the user switch away from MiniMax.
          if (provider.type === "minimax" || provider.type === "minimax_cn") {
            saveModel(
              encodeModelSelection(
                provider.id,
                MINIMAX_IMAGE_GENERATION_MODEL_OPTIONS[0].id
              )
            );

            return;
          }

          toast("Provider added.");
        }}
        onClosed={() => setAddFormKey((key) => key + 1)}
        onOpenChange={setAddMinimaxOpen}
        open={addMinimaxOpen}
        provider="minimax"
      />
    </SettingsModelTile>
  );
}

const CLEAR_VIDEO_GENERATION_MODEL_VALUE = "__video_generation_unset__";

/** `__video_custom__:<providerId>` opens the model ID form for that provider. */
const CUSTOM_VIDEO_MODEL_PREFIX = "__video_custom__:";

/** Video comes only from MiniMax Hailuo, so each MiniMax provider lists its models. */
export function VideoGenerationSettingsCard() {
  const [formError, setFormError] = useState<string | null>(null);
  const { data: modelsResponse } = useModelsQuery();
  const { data: videoGenerationSettings } = useVideoGenerationSettings();
  const saveMutation = useSaveVideoGenerationSettings();
  const [addMinimaxOpen, setAddMinimaxOpen] = useState(false);
  const [addFormKey, setAddFormKey] = useState(0);

  const [customProviderId, setCustomProviderId] = useState<string | null>(null);

  const [customModelId, setCustomModelId] = useState("");

  // undefined until the saved model loads, so it does not read as None.
  const selection = videoGenerationSettings
    ? (videoGenerationSettings.model ?? null)
    : undefined;

  const choices = useMemo(() => {
    const minimaxProviders = (modelsResponse?.providers ?? []).filter(
      (provider) =>
        provider.type === "minimax" || provider.type === "minimax_cn"
    );

    const saved = selection ? decodeModelSelection(selection) : null;

    const options: SettingsModelOption[] = [
      { label: "None", value: CLEAR_VIDEO_GENERATION_MODEL_VALUE },
      ...minimaxProviders.flatMap((provider) => {
        const group = { id: provider.id, label: provider.label };

        const suggested = MINIMAX_VIDEO_GENERATION_MODEL_OPTIONS.map(
          (option) => ({
            label: `${provider.label}: ${option.name}`,
            name: option.name,
            provider: group,
            value: encodeModelSelection(provider.id, option.id),
          })
        );

        // A saved model ID that is not a suggestion stays pickable.
        const savedCustom =
          saved?.providerId === provider.id &&
          !suggested.some((option) => option.value === selection)
            ? [
                {
                  label: `${provider.label}: ${saved.modelId}`,
                  name: saved.modelId,
                  provider: group,
                  value: encodeModelSelection(provider.id, saved.modelId),
                },
              ]
            : [];

        return [
          ...suggested,
          ...savedCustom,
          {
            label: `${provider.label}: Custom model ID…`,
            name: "Custom model ID…",
            provider: group,
            value: `${CUSTOM_VIDEO_MODEL_PREFIX}${provider.id}`,
          },
        ];
      }),
      ...(minimaxProviders.length === 0
        ? [{ label: "MiniMax", value: ADD_MINIMAX_VALUE }]
        : []),
    ];

    return options;
  }, [modelsResponse?.providers, selection]);

  const triggerLabel =
    selection === undefined
      ? "Loading…"
      : selection === null
        ? "None"
        : (choices.find((choice) => choice.value === selection)?.label ??
          "Unavailable model");

  const saveModel = (model: string | null) => {
    setFormError(null);
    const previous = selection ?? null;

    saveMutation.mutate(model, {
      onError: (error) => setFormError(formatError(error)),
      onSuccess: (saved) => {
        if (previous !== (saved.model ?? null)) {
          toast("Video generation model changed.", 8000, {
            label: "Undo",
            onClick: () => saveMutation.mutate(previous),
          });
        }
      },
    });
  };

  return (
    <SettingsModelTile
      footer={
        formError ? (
          <p className="text-destructive text-xs" role="alert">
            {formError}
          </p>
        ) : undefined
      }
      title="Video generation model"
    >
      <SettingsModelSelect
        ariaLabel="Video generation model"
        disabled={selection === undefined || saveMutation.isPending}
        onValueChange={(value) => {
          if (!value) {
            return;
          }

          if (value === ADD_MINIMAX_VALUE) {
            setAddMinimaxOpen(true);

            return;
          }

          if (value.startsWith(CUSTOM_VIDEO_MODEL_PREFIX)) {
            const providerId = value.slice(CUSTOM_VIDEO_MODEL_PREFIX.length);
            const saved = selection ? decodeModelSelection(selection) : null;

            setCustomModelId(
              saved?.providerId === providerId ? saved.modelId : ""
            );
            setCustomProviderId(providerId);

            return;
          }

          saveModel(
            value === CLEAR_VIDEO_GENERATION_MODEL_VALUE ? null : String(value)
          );
        }}
        options={choices}
        triggerLabel={triggerLabel}
        value={selection ?? CLEAR_VIDEO_GENERATION_MODEL_VALUE}
      />
      <AddProviderDialog
        key={addFormKey}
        onAdded={(provider) => {
          if (provider.type === "minimax" || provider.type === "minimax_cn") {
            saveModel(
              encodeModelSelection(
                provider.id,
                MINIMAX_VIDEO_GENERATION_MODEL_OPTIONS[0].id
              )
            );

            return;
          }

          toast("Provider added.");
        }}
        onClosed={() => setAddFormKey((key) => key + 1)}
        onOpenChange={setAddMinimaxOpen}
        open={addMinimaxOpen}
        provider="minimax"
      />
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setCustomProviderId(null);
          }
        }}
        open={customProviderId !== null}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              const modelId = customModelId.trim();

              if (!(customProviderId && modelId)) {
                return;
              }

              saveModel(encodeModelSelection(customProviderId, modelId));
              setCustomProviderId(null);
            }}
          >
            <DialogHeader>
              <DialogTitle>Custom model ID</DialogTitle>
            </DialogHeader>
            <Input
              aria-label="Model ID"
              autoFocus
              onChange={(event) => setCustomModelId(event.target.value)}
              placeholder="MiniMax-Hailuo-2.3"
              value={customModelId}
            />
            <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setCustomProviderId(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={!customModelId.trim()} type="submit">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsModelTile>
  );
}
