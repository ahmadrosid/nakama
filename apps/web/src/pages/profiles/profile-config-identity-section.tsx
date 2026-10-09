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
  } = state;

  const [modelPickerOpen, setModelPickerOpen] = useState(false);

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
            className="w-full min-w-0 sm:w-auto sm:min-w-[12rem] sm:max-w-[14rem]"
            htmlFor="profile-model"
            label="Model"
          >
            <Popover onOpenChange={setModelPickerOpen} open={modelPickerOpen}>
              <PopoverTrigger
                aria-label="Select model"
                className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
                disabled={identityDisabled || providerModelGroups.length === 0}
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
                    {extractModelId(editModel) && !modelInCatalog ? (
                      <CommandItem
                        data-checked={
                          modelSelectionValue ===
                          encodeModelSelection(
                            "__unknown__",
                            extractModelId(editModel)!
                          )
                        }
                        onSelect={() => {
                          handleEditModelChange(
                            encodeModelSelection(
                              "__unknown__",
                              extractModelId(editModel)!
                            )
                          );
                          setModelPickerOpen(false);
                        }}
                        value={extractModelId(editModel)!}
                      >
                        {extractModelId(editModel)}
                      </CommandItem>
                    ) : null}
                    {providerModelGroups.flatMap((group) =>
                      group.models.map((model) => {
                        const value = encodeModelSelection(
                          group.providerId,
                          model.id
                        );

                        return (
                          <CommandItem
                            data-checked={modelSelectionValue === value}
                            key={`${group.providerId}:${model.id}`}
                            onSelect={() => {
                              handleEditModelChange(value);
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
          </Field>
        </div>

        <div className="flex min-w-0 flex-wrap items-end gap-3 px-4 py-3">
          <Field
            className="w-full min-w-0 sm:w-auto sm:min-w-[12rem] sm:max-w-[14rem]"
            htmlFor="profile-chat-agent"
            label="Chat agent"
          >
            <select
              className="flex h-8 w-full cursor-pointer items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              disabled={identityDisabled}
              id="profile-chat-agent"
              onChange={(event) => void handleEditAcpAgent(event.target.value)}
              value={acpAgentId ?? (detail.acpAgent ? "custom" : "")}
            >
              <option value="">Nakama built-in</option>
              {acpAgentPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              {detail.acpAgent && !acpAgentId ? (
                <option disabled value="custom">
                  Custom command
                </option>
              ) : null}
            </select>
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
