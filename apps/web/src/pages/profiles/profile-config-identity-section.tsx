import type { AcpAgentPresetSummary } from "@nakama/core/contract";
import { Card, CardContent } from "@nakama/ui/card";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nakama/ui/command";
import { ExpandableTextarea } from "@nakama/ui/expandable-textarea";
import { Input } from "@nakama/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { ArrowDown01Icon } from "hugeicons-react";
import { useState } from "react";
import {
  encodeModelSelection,
  extractModelId,
  profileModelLabel,
} from "@/lib/models";
import {
  EditableProfileAvatar,
  Field,
  ProfileSaveIndicator,
} from "@/pages/profiles/profiles-ui";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

type IdentityState = Pick<
  ProfilesPageState,
  | "detail"
  | "busy"
  | "canManageProfile"
  | "avatarInputRef"
  | "uploadAvatarMutation"
  | "deleteAvatarMutation"
  | "editName"
  | "handleEditNameChange"
  | "flushSave"
  | "modelSelectionValue"
  | "providerModelGroups"
  | "handleEditModelChange"
  | "editModel"
  | "modelInCatalog"
  | "saveStatus"
  | "isDirty"
  | "editPrompt"
  | "handleEditPromptChange"
  | "handleAvatarSelected"
  | "handleAvatarRemove"
  | "acpAgentId"
  | "acpAgentPresets"
  | "handleEditAcpAgent"
  | "acpCurrentModelSelection"
  | "acpEffortOptions"
  | "acpEffortValue"
  | "acpIsSaving"
  | "acpModelGroups"
  | "setAcpEffort"
  | "setAcpModel"
>;

export function ProfileConfigIdentitySection({
  state,
}: {
  state: IdentityState;
}) {
  const {
    detail,
    busy,
    canManageProfile,
    avatarInputRef,
    uploadAvatarMutation,
    deleteAvatarMutation,
    editName,
    handleEditNameChange,
    flushSave,
    modelSelectionValue,
    providerModelGroups,
    handleEditModelChange,
    editModel,
    modelInCatalog,
    saveStatus,
    isDirty,
    editPrompt,
    handleEditPromptChange,
    handleAvatarSelected,
    handleAvatarRemove,
    acpAgentId,
    acpAgentPresets,
    handleEditAcpAgent,
    acpCurrentModelSelection,
    acpEffortOptions,
    acpEffortValue,
    acpIsSaving,
    acpModelGroups,
    setAcpEffort,
    setAcpModel,
  } = state;

  if (!detail) {
    return null;
  }

  const identityDisabled = busy || !canManageProfile;

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <input
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        disabled={identityDisabled}
        onChange={(event) => void handleAvatarSelected(event)}
        ref={avatarInputRef}
        type="file"
      />

      <CardContent className="min-w-0 divide-y divide-border p-0">
        <div className="flex min-w-0 flex-wrap items-end gap-3 px-4 py-3 sm:flex-nowrap">
          <EditableProfileAvatar
            disabled={
              identityDisabled ||
              uploadAvatarMutation.isPending ||
              deleteAvatarMutation.isPending
            }
            onPick={() => avatarInputRef.current?.click()}
            onRemove={handleAvatarRemove}
            profile={detail}
            size="ml"
            uploading={
              uploadAvatarMutation.isPending || deleteAvatarMutation.isPending
            }
          />

          <Field className="min-w-0 flex-1" htmlFor="profile-name" label="Name">
            <Input
              className="h-8 min-w-0 font-normal"
              disabled={identityDisabled}
              id="profile-name"
              onBlur={() => void flushSave()}
              onChange={(event) => handleEditNameChange(event.target.value)}
              readOnly={!canManageProfile}
              value={editName}
            />
          </Field>

          <Field
            className="w-full min-w-0 sm:w-auto sm:max-w-[26rem]"
            htmlFor="profile-chat-agent"
            label="Agent"
          >
            <div className="flex h-8 min-w-0 overflow-hidden rounded-lg border border-input dark:bg-input/30">
              <ProfileChatAgentField
                disabled={identityDisabled}
                hasCustomAgent={Boolean(detail.acpAgent) && !acpAgentId}
                onChange={handleEditAcpAgent}
                presets={acpAgentPresets}
                selectedPresetId={acpAgentId}
              />

              <ProfileModelField
                disabled={identityDisabled || acpIsSaving}
                editModel={
                  detail.acpAgent ? acpCurrentModelSelection : editModel
                }
                modelInCatalog={detail.acpAgent ? true : modelInCatalog}
                modelSelectionValue={
                  detail.acpAgent
                    ? acpCurrentModelSelection
                    : modelSelectionValue
                }
                onChange={detail.acpAgent ? setAcpModel : handleEditModelChange}
                providerModelGroups={
                  detail.acpAgent ? acpModelGroups : providerModelGroups
                }
              />
              {detail.acpAgent && acpEffortOptions?.length ? (
                <Select
                  disabled={identityDisabled || acpIsSaving}
                  onValueChange={(value) => {
                    if (value) {
                      setAcpEffort(value);
                    }
                  }}
                  value={acpEffortValue}
                >
                  <SelectTrigger
                    aria-label="Reasoning effort"
                    className="h-full w-auto rounded-none border-0 dark:bg-transparent"
                  >
                    <SelectValue placeholder="Effort" />
                  </SelectTrigger>
                  <SelectContent>
                    {acpEffortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </Field>
        </div>

        {(detail.isSuper ||
          saveStatus !== "idle" ||
          (isDirty && !editName.trim())) && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-4 py-3 text-muted-foreground text-xs">
            {detail.isSuper ? (
              <span className="scope-badge bg-muted text-muted-foreground">
                super
              </span>
            ) : null}
            <ProfileSaveIndicator
              inline
              leadingSeparator={detail.isSuper}
              nameMissing={isDirty && !editName.trim()}
              saveStatus={saveStatus}
            />
          </div>
        )}

        <div className="px-4 py-3">
          <ExpandableTextarea
            dialogDescription="Instructions sent to the model at the start of each chat."
            disabled={identityDisabled}
            htmlFor="profile-prompt"
            label="System prompt"
            onChange={(event) => handleEditPromptChange(event.target.value)}
            onSave={flushSave}
            value={editPrompt}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileModelField({
  disabled,
  editModel,
  modelInCatalog,
  modelSelectionValue,
  onChange,
  providerModelGroups,
}: {
  disabled: boolean;
  editModel: string | null;
  modelInCatalog: boolean;
  modelSelectionValue: string | null;
  onChange: (model: string) => void;
  providerModelGroups: ProfilesPageState["providerModelGroups"];
}) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const unknownModelId = extractModelId(editModel);

  return (
    <Popover onOpenChange={setModelPickerOpen} open={modelPickerOpen}>
      <PopoverTrigger
        aria-label="Select model"
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-input/50"
        disabled={disabled || providerModelGroups.length === 0}
        id="profile-model"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {profileModelLabel(editModel, providerModelGroups)}
        </span>
        <ArrowDown01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-w-[min(24rem,92vw)] overflow-hidden p-0"
      >
        <Command className="rounded-lg bg-transparent p-0">
          <div className="border-border/60 border-b p-2 [&_[data-slot=command-input-wrapper]]:p-0">
            <CommandInput
              aria-label="Search models"
              autoFocus
              placeholder="Search models…"
            />
          </div>
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No model found.</CommandEmpty>
            {unknownModelId && !modelInCatalog ? (
              <CommandItem
                data-checked={
                  modelSelectionValue ===
                  encodeModelSelection("__unknown__", unknownModelId)
                }
                onSelect={() => {
                  onChange(encodeModelSelection("__unknown__", unknownModelId));
                  setModelPickerOpen(false);
                }}
                value={unknownModelId}
              >
                {unknownModelId}
              </CommandItem>
            ) : null}
            {providerModelGroups.flatMap((group) =>
              group.models.map((model) => {
                const value = encodeModelSelection(group.providerId, model.id);

                return (
                  <CommandItem
                    data-checked={modelSelectionValue === value}
                    key={`${group.providerId}:${model.id}`}
                    onSelect={() => {
                      onChange(value);
                      setModelPickerOpen(false);
                    }}
                    value={`${group.providerLabel} ${model.name} ${model.id}`}
                  >
                    {group.providerLabel}: {model.name}
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProfileChatAgentField({
  disabled,
  hasCustomAgent,
  onChange,
  presets,
  selectedPresetId,
}: {
  disabled: boolean;
  hasCustomAgent: boolean;
  onChange: (presetId: string) => Promise<void>;
  presets: AcpAgentPresetSummary[];
  selectedPresetId: string | null;
}) {
  // Radix select items cannot be empty strings, so the built-in chat uses a
  // sentinel that maps back to "no agent" on save.
  const builtInValue = "builtin";
  const value = selectedPresetId ?? (hasCustomAgent ? "custom" : builtInValue);

  return (
    <Select
      disabled={disabled}
      onValueChange={(next) =>
        void onChange(next === builtInValue ? "" : (next ?? ""))
      }
      value={value}
    >
      <SelectTrigger
        aria-label="Chat agent"
        className="h-full w-auto rounded-none border-0 border-input border-r dark:bg-transparent"
        id="profile-chat-agent"
      >
        <SelectValue placeholder="Nakama">
          {presets.find((preset) => preset.id === selectedPresetId)?.label ??
            (hasCustomAgent ? "Custom command" : "Nakama")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={builtInValue}>Nakama</SelectItem>
        {presets.map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            {preset.label}
          </SelectItem>
        ))}
        {hasCustomAgent ? (
          <SelectItem disabled value="custom">
            Custom command
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}
