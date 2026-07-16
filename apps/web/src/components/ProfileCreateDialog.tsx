import type { ToolSummary } from "@nakama/core/contract";
import { useEffect, useMemo, useReducer, useRef, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ProfileCreateDialogForm } from "@/components/profile-create-dialog-form";
import {
  useAssignToolMutation,
  useCreateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { fileToImageAttachment } from "@/lib/profile-images";

interface ProfileCreateDialogProps {
  open: boolean;
  tools: ToolSummary[];
  onCreated: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
}

const defaultCreatePrompt = "You are a helpful assistant.";
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

type ProfileCreateFormState = {
  submitError: string | null;
  name: string;
  profileId: string;
  prompt: string;
  avatarPreview: string | null;
  toolIds: string[];
};

type ProfileCreateFormAction =
  | { type: "reset" }
  | { type: "patch"; values: Partial<ProfileCreateFormState> }
  | { type: "add-tool"; toolId: string }
  | { type: "remove-tool"; toolId: string }
  | { type: "set-avatar-preview"; preview: string | null; revokePrevious?: boolean };

const initialProfileCreateFormState: ProfileCreateFormState = {
  submitError: null,
  name: "",
  profileId: "",
  prompt: defaultCreatePrompt,
  avatarPreview: null,
  toolIds: [],
};

function profileCreateFormReducer(
  state: ProfileCreateFormState,
  action: ProfileCreateFormAction,
): ProfileCreateFormState {
  switch (action.type) {
    case "reset":
      if (state.avatarPreview) {
        URL.revokeObjectURL(state.avatarPreview);
      }
      return initialProfileCreateFormState;
    case "patch":
      return { ...state, ...action.values };
    case "add-tool":
      if (!action.toolId || state.toolIds.includes(action.toolId)) {
        return state;
      }
      return { ...state, toolIds: [...state.toolIds, action.toolId] };
    case "remove-tool":
      return {
        ...state,
        toolIds: state.toolIds.filter((id) => id !== action.toolId),
      };
    case "set-avatar-preview": {
      if (action.revokePrevious && state.avatarPreview) {
        URL.revokeObjectURL(state.avatarPreview);
      }
      return { ...state, avatarPreview: action.preview };
    }
    default:
      return state;
  }
}

function slugifyProfileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "profile"
  );
}

export function ProfileCreateDialog({
  open,
  tools,
  onCreated,
  onOpenChange,
}: ProfileCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ProfileCreateDialogContent
          tools={tools}
          onCreated={onCreated}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function ProfileCreateDialogContent({
  tools,
  onCreated,
  onOpenChange,
}: {
  tools: ToolSummary[];
  onCreated: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const assignToolMutation = useAssignToolMutation();
  const createAvatarInputRef = useRef<HTMLInputElement>(null);
  const [form, dispatch] = useReducer(profileCreateFormReducer, initialProfileCreateFormState);
  const profileIdEditedRef = useRef(false);
  const avatarFileRef = useRef<File | null>(null);

  const busy =
    createMutation.isPending || uploadAvatarMutation.isPending || assignToolMutation.isPending;
  const profileIdTrimmed = form.profileId.trim();
  const profileIdValid =
    Boolean(profileIdTrimmed) && PROFILE_ID_PATTERN.test(profileIdTrimmed);
  const profileIdHasValue = form.profileId.length > 0;
  const profileIdHelpText = !profileIdHasValue || profileIdValid
    ? "Auto-generated from the name. Use letters, numbers, `_`, or `-`."
    : "Profile id must start with a letter or number and only use letters, numbers, `_`, or `-`.";
  const toolIdSet = useMemo(() => new Set(form.toolIds), [form.toolIds]);
  const availableTools = tools.filter((tool) => !toolIdSet.has(tool.id));
  const selectableTools = availableTools;
  const selectedTools = tools.filter((tool) => toolIdSet.has(tool.id));

  useEffect(() => {
    if (profileIdEditedRef.current) {
      return;
    }

    dispatch({
      type: "patch",
      values: { profileId: form.name.trim() ? slugifyProfileName(form.name) : "" },
    });
  }, [form.name]);

  function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({ type: "set-avatar-preview", preview: null, revokePrevious: true });
    avatarFileRef.current = file;
    dispatch({
      type: "set-avatar-preview",
      preview: URL.createObjectURL(file),
      revokePrevious: false,
    });
  }

  function handleToolSelect(toolId: string) {
    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({ type: "add-tool", toolId });
  }

  function handleRemoveTool(toolId: string) {
    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({ type: "remove-tool", toolId });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!form.name.trim() || !profileIdValid || busy) {
      dispatch({
        type: "patch",
        values: {
          submitError: !form.name.trim()
            ? "Name is required."
            : "Profile id must start with a letter or number and only use letters, numbers, `_`, or `-`.",
        },
      });
      return;
    }

    dispatch({ type: "patch", values: { submitError: null } });

    try {
      const response = await createMutation.mutateAsync({
        id: profileIdTrimmed,
        name: form.name.trim(),
        systemPrompt: form.prompt.trim() || undefined,
      });

      const avatarFile = avatarFileRef.current;
      if (avatarFile) {
        const attachment = await fileToImageAttachment(avatarFile);

        if (!attachment) {
          dispatch({
            type: "patch",
            values: {
              submitError: "Profile created, but the selected image could not be read.",
            },
          });
        } else {
          await uploadAvatarMutation.mutateAsync({
            profileId: response.profile.id,
            attachment,
          });
        }
      }

      await Promise.all(
        form.toolIds.map((toolId) =>
          assignToolMutation.mutateAsync({
            profileId: response.profile.id,
            toolId,
          }),
        ),
      );

      onOpenChange(false);
      onCreated(response.profile.id);
    } catch (error) {
      dispatch({ type: "patch", values: { submitError: formatError(error) } });
    }
  }

  return (
    <DialogContent className="flex max-h-[min(90dvh,42rem)] flex-col gap-6 overflow-hidden p-6 sm:max-w-4xl">
      <form className="flex min-h-0 flex-1 flex-col gap-6" onSubmit={handleSubmit}>
        <DialogHeader className="gap-2">
          <DialogTitle>Create profile</DialogTitle>
          <DialogDescription>
            Name, profile id, and system prompt for the new bot profile.
          </DialogDescription>
        </DialogHeader>

        <ProfileCreateDialogForm
          busy={busy}
          submitError={form.submitError}
          name={form.name}
          profileId={form.profileId}
          profileIdHasValue={profileIdHasValue}
          profileIdValid={profileIdValid}
          profileIdHelpText={profileIdHelpText}
          prompt={form.prompt}
          avatarPreview={form.avatarPreview}
          avatarInputRef={createAvatarInputRef}
          tools={tools}
          selectableTools={selectableTools}
          selectedTools={selectedTools}
          onNameChange={(value) => {
            dispatch({ type: "patch", values: { submitError: null, name: value } });
          }}
          onProfileIdChange={(value) => {
            dispatch({ type: "patch", values: { submitError: null, profileId: value } });
            profileIdEditedRef.current = true;
          }}
          onPromptChange={(value) => {
            dispatch({ type: "patch", values: { submitError: null, prompt: value } });
          }}
          onAvatarSelected={handleAvatarSelected}
          onClearAvatar={() => {
            dispatch({ type: "patch", values: { submitError: null } });
            dispatch({ type: "set-avatar-preview", preview: null, revokePrevious: true });
            avatarFileRef.current = null;
          }}
          onToolSelect={handleToolSelect}
          onRemoveTool={handleRemoveTool}
        />

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !form.name.trim() || !profileIdValid}>
            {busy ? <Spinner className="size-4" /> : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
