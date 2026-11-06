import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { toast } from "@nakama/ui/toast";
import { useEffect, useMemo, useState } from "react";
import { SettingsModelTile } from "@/components/settings/settings-model-tile";
import {
  useModelsQuery,
  useSaveTranscriptionSettings,
  useTranscriptionSettings,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  encodeModelSelection,
  groupModelsByProvider,
  profileModelLabel,
  profileModelSelectionValue,
  TRANSCRIPTION_MODEL_OPTIONS,
} from "@/lib/models";

const CLEAR_TRANSCRIPTION_MODEL_VALUE = "__transcription_unset__";

const ADD_OPENAI_VALUE = "__add_openai__";

export function TranscriptionSettingsCard({
  onAddProvider,
}: {
  onAddProvider?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string>("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const { data: modelsResponse } = useModelsQuery();
  const { data: transcriptionSettings } = useTranscriptionSettings();
  const saveTranscriptionMutation = useSaveTranscriptionSettings();

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(modelsResponse?.models ?? []),
    [modelsResponse?.models]
  );

  const transcriptionModelGroups = useMemo(() => {
    const groups: typeof providerModelGroups = [];

    for (const group of providerModelGroups) {
      if (group.models.some((model) => model.provider === "openai")) {
        groups.push({
          ...group,
          models: TRANSCRIPTION_MODEL_OPTIONS.map((option) => ({
            id: option.id,
            name: option.name,
            provider: "openai" as const,
          })),
        });
      }
    }

    return groups;
  }, [providerModelGroups]);

  const transcriptionUnavailable = transcriptionModelGroups.length === 0;

  const selectionValue = useMemo(() => {
    if (!selection) {
      return CLEAR_TRANSCRIPTION_MODEL_VALUE;
    }

    return (
      profileModelSelectionValue(selection, transcriptionModelGroups) ||
      CLEAR_TRANSCRIPTION_MODEL_VALUE
    );
  }, [selection, transcriptionModelGroups]);

  useEffect(() => {
    setSelection(transcriptionSettings?.model ?? "");
  }, [transcriptionSettings?.model]);

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
      title="Audio transcription model"
    >
      <Select
        disabled={
          saveTranscriptionMutation.isPending ||
          (transcriptionUnavailable && !onAddProvider)
        }
        onValueChange={(value) => {
          if (!value) {
            return;
          }

          if (value === ADD_OPENAI_VALUE) {
            onAddProvider?.();

            return;
          }

          const model =
            value === CLEAR_TRANSCRIPTION_MODEL_VALUE ? null : String(value);

          setFormError(null);
          setSelection(model ?? "");
          setSavedHint(null);

          // A change can be undone from the toast.
          const previous = transcriptionSettings?.model ?? null;

          saveTranscriptionMutation.mutate(model, {
            onError: (error) => {
              setSelection(transcriptionSettings?.model ?? "");
              setFormError(formatError(error));
            },
            onSuccess: (saved) => {
              setSelection(saved.model ?? "");

              if (previous !== (saved.model ?? null)) {
                toast("Audio transcription model changed.", 8000, {
                  label: "Undo",
                  onClick: () =>
                    saveTranscriptionMutation.mutate(previous, {
                      onSuccess: (restored) =>
                        setSelection(restored.model ?? ""),
                    }),
                });
              }

              setSavedHint(
                saved.model
                  ? `Saved · ${profileModelLabel(saved.model, transcriptionModelGroups)}`
                  : "Cleared"
              );
            },
          });
        }}
        value={selectionValue}
      >
        <SelectTrigger
          aria-label="Audio transcription model"
          className="h-8 w-full"
        >
          <SelectValue
            className="truncate"
            placeholder="Select transcription model"
          >
            {selection
              ? profileModelLabel(selection, transcriptionModelGroups, {
                  withProvider: true,
                })
              : "None"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          className="w-max min-w-72 max-w-[min(24rem,92vw)]"
        >
          <SelectItem value={CLEAR_TRANSCRIPTION_MODEL_VALUE}>None</SelectItem>
          {transcriptionUnavailable && onAddProvider ? (
            <SelectItem value={ADD_OPENAI_VALUE}>
              Add OpenAI provider…
            </SelectItem>
          ) : null}
          {transcriptionModelGroups.flatMap((group) =>
            group.models.map((model) => (
              <SelectItem
                key={`${group.providerId}:${model.id}`}
                value={encodeModelSelection(group.providerId, model.id)}
              >
                {model.name} · {group.providerLabel}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </SettingsModelTile>
  );
}
