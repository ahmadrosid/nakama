import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import {
  encodeModelSelection,
  extractModelId,
  profileModelLabel,
} from "@/lib/models";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";
import { EditableProfileAvatar, Field, ProfileSaveIndicator } from "@/pages/profiles/profiles-ui";

type IdentityState = Pick<
  ProfilesPageState,
  | "detail"
  | "busy"
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
>;

export function ProfileConfigIdentitySection({ state }: { state: IdentityState }) {
  const {
    detail,
    busy,
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
  } = state;

  if (!detail) {
    return null;
  }

  return (
    <div className="mb-3 rounded-2xl border border-border p-3 sm:p-4">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        disabled={busy}
        onChange={(event) => void handleAvatarSelected(event)}
      />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3 sm:flex-nowrap">
          <EditableProfileAvatar
            profile={detail}
            size="ml"
            disabled={
              busy || uploadAvatarMutation.isPending || deleteAvatarMutation.isPending
            }
            uploading={
              uploadAvatarMutation.isPending || deleteAvatarMutation.isPending
            }
            onPick={() => avatarInputRef.current?.click()}
            onRemove={() => void handleAvatarRemove()}
          />

          <Field label="Name" htmlFor="profile-name" className="min-w-0 flex-1">
            <Input
              id="profile-name"
              value={editName}
              disabled={busy}
              className="h-8 min-w-0 font-semibold"
              onChange={(event) => handleEditNameChange(event.target.value)}
              onBlur={() => void flushSave()}
            />
          </Field>

          <Field
            label="Model"
            htmlFor="profile-model"
            className="w-full min-w-0 sm:w-auto sm:min-w-[12rem] sm:max-w-[14rem]"
          >
            <Select
              value={modelSelectionValue}
              disabled={busy || providerModelGroups.length === 0}
              onValueChange={(value) => {
                if (!value) {
                  return;
                }

                handleEditModelChange(String(value));
              }}
            >
              <SelectTrigger id="profile-model" className="w-full">
                <SelectValue placeholder="Select model">
                  {profileModelLabel(editModel, providerModelGroups)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                alignItemWithTrigger={false}
                className="w-max min-w-72 max-w-[min(24rem,92vw)]"
              >
                {extractModelId(editModel) && !modelInCatalog ? (
                  <SelectItem
                    value={encodeModelSelection("__unknown__", extractModelId(editModel)!)}
                  >
                    {extractModelId(editModel)}
                  </SelectItem>
                ) : null}
                {providerModelGroups.flatMap((group) =>
                  group.models.map((model) => (
                    <SelectItem
                      key={`${group.providerId}:${model.id}`}
                      value={encodeModelSelection(group.providerId, model.id)}
                    >
                      {group.providerLabel}: {model.name}
                    </SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {(detail.isSuper || saveStatus !== "idle" || (isDirty && !editName.trim())) && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {detail.isSuper ? (
              <span className="scope-badge bg-muted text-muted-foreground">super</span>
            ) : null}
            <ProfileSaveIndicator
              inline
              leadingSeparator={detail.isSuper}
              saveStatus={saveStatus}
              nameMissing={isDirty && !editName.trim()}
            />
          </div>
        )}

        <ExpandableTextarea
          label="System prompt"
          htmlFor="profile-prompt"
          dialogDescription="Instructions sent to the model at the start of each chat."
          value={editPrompt}
          disabled={busy}
          onChange={(event) => handleEditPromptChange(event.target.value)}
          onSave={flushSave}
        />
      </div>
    </div>
  );
}
