import type {
  AcpAgentPresetSummary,
  ImageAttachment,
  ToolSummary,
} from "@nakama/core/contract";
import { parseDataUrl } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import {
  type ChangeEvent,
  type FormEvent,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  BUILT_IN_AGENT,
  ProfileCreateDialogForm,
} from "@/components/profile-create-dialog-form";
import {
  useAssignToolMutation,
  useCreateProfileMutation,
  useUpdateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { readFileAsDataUrl } from "../lib/read-file-as-data-url";

function fileToImageAttachment(file: File): Promise<ImageAttachment | null> {
  return readFileAsDataUrl(file).then(parseDataUrl, () => null);
}

interface ProfileCreateDialogProps {
  agentPresets: AcpAgentPresetSummary[];
  onAskSuperBot?: () => void;
  onCreated: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tools: ToolSummary[];
}

const defaultCreatePrompt = "You are a helpful assistant.";

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

type ProfileCreateFormState = {
  submitError: string | null;
  name: string;
  profileId: string;
  avatarPreview: string | null;
  agentId: string;
  toolIds: string[];
};

type ProfileCreateFormAction =
  | { type: "reset" }
  | { type: "patch"; values: Partial<ProfileCreateFormState> }
  | { type: "add-tool"; toolId: string }
  | { type: "remove-tool"; toolId: string }
  | {
      type: "set-avatar-preview";
      preview: string | null;
      revokePrevious?: boolean;
    };

const initialProfileCreateFormState: ProfileCreateFormState = {
  agentId: BUILT_IN_AGENT,
  avatarPreview: null,
  name: "",
  profileId: "",
  submitError: null,
  toolIds: [],
};

function profileCreateFormReducer(
  state: ProfileCreateFormState,
  action: ProfileCreateFormAction
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

export function ProfileCreateDialog({
  agentPresets,
  open,
  tools,
  onCreated,
  onOpenChange,
  onAskSuperBot,
}: ProfileCreateDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <ProfileCreateDialogContent
          agentPresets={agentPresets}
          onAskSuperBot={onAskSuperBot}
          onCreated={onCreated}
          onOpenChange={onOpenChange}
          tools={tools}
        />
      ) : null}
    </Dialog>
  );
}

function ProfileCreateDialogContent({
  agentPresets,
  tools,
  onCreated,
  onOpenChange,
  onAskSuperBot,
}: {
  agentPresets: AcpAgentPresetSummary[];
  tools: ToolSummary[];
  onCreated: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
  onAskSuperBot?: () => void;
}) {
  const createMutation = useCreateProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const assignToolMutation = useAssignToolMutation();
  const updateProfileMutation = useUpdateProfileMutation();
  const createAvatarInputRef = useRef<HTMLInputElement>(null);

  const [form, dispatch] = useReducer(
    profileCreateFormReducer,
    initialProfileCreateFormState
  );

  const avatarFileRef = useRef<File | null>(null);

  const busy =
    createMutation.isPending ||
    uploadAvatarMutation.isPending ||
    assignToolMutation.isPending ||
    updateProfileMutation.isPending;

  const profileIdTrimmed = form.profileId.trim();

  const profileIdValid =
    !profileIdTrimmed || PROFILE_ID_PATTERN.test(profileIdTrimmed);

  const profileIdHasValue = form.profileId.length > 0;

  const profileIdHelpText = profileIdValid
    ? "Optional. Letters, numbers, `_`, `-` only."
    : "Agent id must start with a letter or number and only use letters, numbers, `_`, or `-`.";

  const toolIdSet = useMemo(() => new Set(form.toolIds), [form.toolIds]);

  function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({
      preview: null,
      revokePrevious: true,
      type: "set-avatar-preview",
    });
    avatarFileRef.current = file;
    dispatch({
      preview: URL.createObjectURL(file),
      revokePrevious: false,
      type: "set-avatar-preview",
    });
  }

  function handleToolToggle(toolId: string, checked: boolean) {
    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({ toolId, type: checked ? "add-tool" : "remove-tool" });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!(form.name.trim() && profileIdValid) || busy) {
      dispatch({
        type: "patch",
        values: {
          submitError: form.name.trim()
            ? "Agent id must start with a letter or number and only use letters, numbers, `_`, or `-`."
            : "Name is required.",
        },
      });

      return;
    }

    dispatch({ type: "patch", values: { submitError: null } });

    try {
      const response = await createMutation.mutateAsync({
        id: profileIdTrimmed || undefined,
        name: form.name.trim(),
        systemPrompt: defaultCreatePrompt,
      });

      const avatarFile = avatarFileRef.current;

      if (avatarFile) {
        const attachment = await fileToImageAttachment(avatarFile);

        if (attachment) {
          await uploadAvatarMutation.mutateAsync({
            attachment,
            profileId: response.profile.id,
          });
        } else {
          dispatch({
            type: "patch",
            values: {
              submitError:
                "Agent created, but the selected image could not be read.",
            },
          });
        }
      }

      if (form.toolIds.length > 0) {
        await assignToolMutation.mutateAsync({
          profileId: response.profile.id,
          toolId: form.toolIds,
        });
      }

      const acpAgent = agentPresets.find(
        (preset) => preset.id === form.agentId
      )?.agent;

      if (acpAgent) {
        await updateProfileMutation.mutateAsync({
          input: { acpAgent },
          profileId: response.profile.id,
        });
      }

      onOpenChange(false);
      onCreated(response.profile.id);
    } catch (error) {
      dispatch({ type: "patch", values: { submitError: formatError(error) } });
    }
  }

  return (
    <DialogContent className="flex max-h-[min(90dvh,48rem)] flex-col gap-5 overflow-hidden p-5 sm:max-w-2xl">
      <form
        className="flex min-h-0 flex-1 flex-col gap-5"
        onSubmit={handleSubmit}
      >
        <DialogHeader className="gap-2">
          <DialogTitle>Create agent</DialogTitle>
          <DialogDescription>
            Set a name. Agent id is optional.
            {onAskSuperBot ? (
              <>
                {" "}
                Or{" "}
                <button
                  className="text-foreground underline underline-offset-2"
                  disabled={busy}
                  onClick={() => {
                    onOpenChange(false);
                    onAskSuperBot();
                  }}
                  type="button"
                >
                  ask Super Bot
                </button>{" "}
                to draft from chat.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <ProfileCreateDialogForm
          agentId={form.agentId}
          agentPresets={agentPresets}
          avatarInputRef={createAvatarInputRef}
          avatarPreview={form.avatarPreview}
          busy={busy}
          name={form.name}
          onAgentChange={(agentId) => {
            dispatch({ type: "patch", values: { agentId, submitError: null } });
          }}
          onAvatarSelected={handleAvatarSelected}
          onClearAvatar={() => {
            dispatch({ type: "patch", values: { submitError: null } });
            dispatch({
              preview: null,
              revokePrevious: true,
              type: "set-avatar-preview",
            });
            avatarFileRef.current = null;
          }}
          onNameChange={(value) => {
            dispatch({
              type: "patch",
              values: { name: value, submitError: null },
            });
          }}
          onProfileIdChange={(value) => {
            dispatch({
              type: "patch",
              values: { profileId: value, submitError: null },
            });
          }}
          onToolsChange={(toolIds) => {
            dispatch({ type: "patch", values: { submitError: null, toolIds } });
          }}
          onToolToggle={handleToolToggle}
          profileId={form.profileId}
          profileIdHasValue={profileIdHasValue}
          profileIdHelpText={profileIdHelpText}
          profileIdValid={profileIdValid}
          selectedToolIds={toolIdSet}
          submitError={form.submitError}
          tools={tools}
        />

        <DialogFooter className="mx-0 mb-0 gap-2 border-t-0 bg-transparent p-0 sm:justify-end">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy || !form.name.trim() || !profileIdValid}
            type="submit"
          >
            {busy ? <Spinner className="size-4" /> : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
