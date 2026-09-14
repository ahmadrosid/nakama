import type { ToolSummary } from "@nakama/core/contract";
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
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { ProfileCreateDialogForm } from "@/components/profile-create-dialog-form";
import {
  useAssignToolMutation,
  useCreateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { fileToImageAttachment } from "@/lib/profile-images";

interface ProfileCreateDialogProps {
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
  onAskSuperBot,
}: ProfileCreateDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <ProfileCreateDialogContent
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
  tools,
  onCreated,
  onOpenChange,
  onAskSuperBot,
}: {
  tools: ToolSummary[];
  onCreated: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
  onAskSuperBot?: () => void;
}) {
  const createMutation = useCreateProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const assignToolMutation = useAssignToolMutation();
  const createAvatarInputRef = useRef<HTMLInputElement>(null);
  const [form, dispatch] = useReducer(
    profileCreateFormReducer,
    initialProfileCreateFormState
  );
  const profileIdEditedRef = useRef(false);
  const avatarFileRef = useRef<File | null>(null);

  const busy =
    createMutation.isPending ||
    uploadAvatarMutation.isPending ||
    assignToolMutation.isPending;
  const profileIdTrimmed = form.profileId.trim();
  const profileIdValid =
    Boolean(profileIdTrimmed) && PROFILE_ID_PATTERN.test(profileIdTrimmed);
  const profileIdHasValue = form.profileId.length > 0;
  const profileIdHelpText =
    !profileIdHasValue || profileIdValid
      ? "From name. Letters, numbers, `_`, `-` only."
      : "Agent id must start with a letter or number and only use letters, numbers, `_`, or `-`.";
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
      values: {
        profileId: form.name.trim() ? slugifyProfileName(form.name) : "",
      },
    });
  }, [form.name]);

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

  function handleToolSelect(toolId: string) {
    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({ toolId, type: "add-tool" });
  }

  function handleRemoveTool(toolId: string) {
    dispatch({ type: "patch", values: { submitError: null } });
    dispatch({ toolId, type: "remove-tool" });
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
        id: profileIdTrimmed,
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

      await Promise.all(
        form.toolIds.map((toolId) =>
          assignToolMutation.mutateAsync({
            profileId: response.profile.id,
            toolId,
          })
        )
      );

      onOpenChange(false);
      onCreated(response.profile.id);
    } catch (error) {
      dispatch({ type: "patch", values: { submitError: formatError(error) } });
    }
  }

  return (
    <DialogContent className="flex max-h-[min(90dvh,42rem)] flex-col gap-5 overflow-hidden p-5 sm:max-w-2xl">
      <form
        className="flex min-h-0 flex-1 flex-col gap-5"
        onSubmit={handleSubmit}
      >
        <DialogHeader className="gap-2">
          <DialogTitle>Create agent</DialogTitle>
          <DialogDescription>
            Set name and agent id.
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
          avatarInputRef={createAvatarInputRef}
          avatarPreview={form.avatarPreview}
          busy={busy}
          name={form.name}
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
            profileIdEditedRef.current = true;
          }}
          onRemoveTool={handleRemoveTool}
          onToolSelect={handleToolSelect}
          profileId={form.profileId}
          profileIdHasValue={profileIdHasValue}
          profileIdHelpText={profileIdHelpText}
          profileIdValid={profileIdValid}
          selectableTools={selectableTools}
          selectedTools={selectedTools}
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
