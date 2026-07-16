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
  modelSelectContentMaxHeightClass,
  profileModelLabel,
} from "@/lib/models";
import { ProfileAssignmentsPanel } from "@/pages/profiles/profile-assignments-panel";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";
import {
  EditableProfileAvatar,
  Field,
  ProfileSaveIndicator,
} from "@/pages/profiles/profiles-ui";

export function ProfileConfigTab({ state }: { state: ProfilesPageState }) {
  const {
    detail,
    busy,
    avatarInputRef,
    uploadAvatarMutation,
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
  } = state;

  if (!detail) {
    return null;
  }

  return (
    <div
      id="profile-detail-panel-profile"
      role="tabpanel"
      aria-labelledby="profile-detail-tab-profile"
    >
      <div className="mb-3 rounded-md border border-border p-3 sm:p-4">
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
              disabled={busy || uploadAvatarMutation.isPending}
              uploading={uploadAvatarMutation.isPending}
              onPick={() => avatarInputRef.current?.click()}
            />

            <div className="min-w-0 flex-1">
              <label
                htmlFor="profile-name"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Name
              </label>
              <Input
                id="profile-name"
                value={editName}
                disabled={busy}
                className="h-8 min-w-0 font-semibold"
                onChange={(event) => handleEditNameChange(event.target.value)}
                onBlur={() => void flushSave()}
              />
            </div>

            <div className="w-full min-w-0 sm:w-auto sm:min-w-[12rem] sm:max-w-[14rem]">
              <Field label="Model" htmlFor="profile-model">
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
                  <SelectContent className={modelSelectContentMaxHeightClass}>
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

      <ProfileAssignmentsPanel state={state} />
    </div>
  );
}
