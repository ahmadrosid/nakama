import type { AcpAgentPresetSummary } from "@nakama/core/contract";
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
import { Switch } from "@nakama/ui/switch";
import { toast } from "@nakama/ui/toast";
import { ArrowDown01Icon } from "hugeicons-react";
import { useState } from "react";
import { useAuth } from "@/context/use-auth";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import {
  encodeModelSelection,
  extractModelId,
  profileModelLabel,
} from "@/lib/models";
import { isProfileOwner } from "@/lib/profiles";
import {
  EditableProfileAvatar,
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
  | "handleAvatarPreset"
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
    saveStatus,
    isDirty,
    handleAvatarPreset,
    handleAvatarSelected,
    handleAvatarRemove,
  } = state;

  const { user } = useAuth();

  if (!detail) {
    return null;
  }

  const identityDisabled = busy || !canManageProfile;
  const nameMissing = isDirty && !editName.trim();

  return (
    <header className="flex w-0 min-w-full flex-col items-center gap-3">
      <input
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        disabled={identityDisabled}
        onChange={(event) => void handleAvatarSelected(event)}
        ref={avatarInputRef}
        type="file"
      />
      <EditableProfileAvatar
        avatarClassName="outline-none"
        disabled={
          identityDisabled ||
          uploadAvatarMutation.isPending ||
          deleteAvatarMutation.isPending
        }
        onPick={() => avatarInputRef.current?.click()}
        onPreset={handleAvatarPreset}
        onRemove={handleAvatarRemove}
        profile={detail}
        size="lg"
        uploading={
          uploadAvatarMutation.isPending || deleteAvatarMutation.isPending
        }
      />
      <Input
        aria-label="Name"
        className="h-auto w-full max-w-md border-transparent bg-transparent px-2 py-1 text-center font-semibold text-2xl shadow-none hover:border-input focus-visible:border-ring md:text-2xl dark:bg-transparent"
        disabled={identityDisabled}
        id="profile-name"
        onBlur={() => void flushSave()}
        onChange={(event) => handleEditNameChange(event.target.value)}
        readOnly={!canManageProfile}
        value={editName}
      />
      <ProfileAgentPicker
        disabled={identityDisabled}
        hasAcpAgent={Boolean(detail.acpAgent)}
        state={state}
      />
      {isProfileOwner(detail, user?.id) ? (
        <ProfileShareToggle
          disabled={identityDisabled}
          profileId={detail.id}
          shared={detail.sharedWithTeam !== false}
        />
      ) : null}
      {detail.isSuper || saveStatus !== "idle" || nameMissing ? (
        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs">
          {detail.isSuper ? (
            <span className="scope-badge bg-muted text-muted-foreground">
              super
            </span>
          ) : null}
          <ProfileSaveIndicator
            inline
            leadingSeparator={detail.isSuper}
            nameMissing={nameMissing}
            saveStatus={saveStatus}
          />
        </div>
      ) : null}
    </header>
  );
}

export function ProfileSystemPromptCard({ state }: { state: IdentityState }) {
  const {
    detail,
    busy,
    canManageProfile,
    editPrompt,
    flushSave,
    handleEditPromptChange,
  } = state;

  if (!detail) {
    return null;
  }

  return (
    <div className="w-full rounded-2xl bg-muted/60 px-5 pt-4 pb-5">
      <ExpandableTextarea
        containerClassName="gap-3"
        dialogDescription="Instructions sent to the model at the start of each chat."
        disabled={busy || !canManageProfile}
        editButtonClassName="h-8 rounded-full bg-background px-3 font-medium text-foreground/80 shadow-xs after:hidden hover:bg-background hover:text-foreground"
        htmlFor="profile-prompt"
        label="System prompt"
        labelClassName="font-medium text-foreground/80 text-sm"
        onChange={(event) => handleEditPromptChange(event.target.value)}
        onSave={flushSave}
        previewClassName="border-0 p-0 hover:bg-transparent dark:bg-transparent"
        value={editPrompt}
      />
    </div>
  );
}

function ProfileShareToggle({
  disabled,
  profileId,
  shared,
}: {
  disabled: boolean;
  profileId: string;
  shared: boolean;
}) {
  const updateMutation = useUpdateProfileMutation();

  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch
        aria-label="Share with team"
        checked={shared}
        disabled={disabled || updateMutation.isPending}
        onCheckedChange={(sharedWithTeam) =>
          void updateMutation
            .mutateAsync({ input: { sharedWithTeam }, profileId })
            .catch((error) => toast(formatError(error)))
        }
        size="sm"
      />
      Share with team
    </label>
  );
}

function ProfileAgentPicker({
  disabled,
  hasAcpAgent,
  state,
}: {
  disabled: boolean;
  hasAcpAgent: boolean;
  state: IdentityState;
}) {
  const {
    acpAgentId,
    acpCurrentModelSelection,
    acpEffortOptions,
    acpEffortValue,
    acpIsSaving,
    acpModelGroups,
  } = state;

  // An ACP agent brings its own model list; the built-in chat uses the
  // configured providers.
  const model = hasAcpAgent
    ? {
        editModel: acpCurrentModelSelection,
        modelInCatalog: true,
        modelSelectionValue: acpCurrentModelSelection,
        onChange: state.setAcpModel,
        providerModelGroups: acpModelGroups,
      }
    : {
        editModel: state.editModel,
        modelInCatalog: state.modelInCatalog,
        modelSelectionValue: state.modelSelectionValue,
        onChange: state.handleEditModelChange,
        providerModelGroups: state.providerModelGroups,
      };

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 text-muted-foreground text-sm">
      <ProfileChatAgentField
        disabled={disabled}
        hasCustomAgent={hasAcpAgent && !acpAgentId}
        onChange={state.handleEditAcpAgent}
        presets={state.acpAgentPresets}
        selectedPresetId={acpAgentId}
      />
      <ProfileModelField disabled={disabled || acpIsSaving} {...model} />
      {hasAcpAgent && acpEffortOptions?.length ? (
        <Select
          disabled={disabled || acpIsSaving}
          onValueChange={(value) => {
            if (value) {
              state.setAcpEffort(value);
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
        className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 font-medium text-foreground/80 text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="h-8 w-auto gap-1.5 rounded-full border-0 bg-muted px-3 font-medium text-foreground/80 text-xs shadow-none hover:text-foreground dark:bg-muted"
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
