import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export function ProfileConfigIdentitySection({
  state,
}: {
  state: IdentityState;
}) {
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
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        disabled={busy}
        onChange={(event) => void handleAvatarSelected(event)}
        ref={avatarInputRef}
        type="file"
      />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3 sm:flex-nowrap">
          <EditableProfileAvatar
            disabled={
              busy ||
              uploadAvatarMutation.isPending ||
              deleteAvatarMutation.isPending
            }
            onPick={() => avatarInputRef.current?.click()}
            onRemove={() => void handleAvatarRemove()}
            profile={detail}
            size="ml"
            uploading={
              uploadAvatarMutation.isPending || deleteAvatarMutation.isPending
            }
          />

          <Field className="min-w-0 flex-1" htmlFor="profile-name" label="Name">
            <Input
              className="h-8 min-w-0 font-semibold"
              disabled={busy}
              id="profile-name"
              onBlur={() => void flushSave()}
              onChange={(event) => handleEditNameChange(event.target.value)}
              value={editName}
            />
          </Field>

          <Field
            className="w-full min-w-0 sm:w-auto sm:min-w-[12rem] sm:max-w-[14rem]"
            htmlFor="profile-model"
            label="Model"
          >
            <Select
              disabled={busy || providerModelGroups.length === 0}
              onValueChange={(value) => {
                if (!value) {
                  return;
                }

                handleEditModelChange(String(value));
              }}
              value={modelSelectionValue}
            >
              <SelectTrigger className="w-full" id="profile-model">
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
                    value={encodeModelSelection(
                      "__unknown__",
                      extractModelId(editModel)!
                    )}
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
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {(detail.isSuper ||
          saveStatus !== "idle" ||
          (isDirty && !editName.trim())) && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs">
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

        <ExpandableTextarea
          dialogDescription="Instructions sent to the model at the start of each chat."
          disabled={busy}
          htmlFor="profile-prompt"
          label="System prompt"
          onChange={(event) => handleEditPromptChange(event.target.value)}
          onSave={flushSave}
          value={editPrompt}
        />
      </div>
    </div>
  );
}
