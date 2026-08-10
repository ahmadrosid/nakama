import type { ProfileSummary } from "@nakama/core/contract";
import { normalizeTaskPrompt } from "@nakama/core/normalize-task-prompt";
import { SparklesIcon } from "hugeicons-react";
import { useReducer } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useDraftTaskPromptMutation } from "@/hooks/use-tasks";
import { formatError } from "@/lib/client";
import { resolveInitialProfileId } from "@/lib/profiles";

interface CreateTaskDialogProps {
  busy: boolean;
  onCreate: (input: {
    title: string;
    description: string;
    prompt: string;
    profileId: string;
  }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  profiles: ProfileSummary[];
}

type CreateTaskFormState = {
  title: string;
  description: string;
  prompt: string;
  profileId: string;
  generateError: string | null;
};

type CreateTaskFormAction =
  | { type: "reset"; profiles: ProfileSummary[] }
  | { type: "patch"; values: Partial<CreateTaskFormState> };

function createInitialFormState(
  profiles: ProfileSummary[]
): CreateTaskFormState {
  return {
    description: "",
    generateError: null,
    profileId: resolveInitialProfileId(profiles),
    prompt: "",
    title: "",
  };
}

function createTaskFormReducer(
  state: CreateTaskFormState,
  action: CreateTaskFormAction
): CreateTaskFormState {
  switch (action.type) {
    case "reset":
      return createInitialFormState(action.profiles);
    case "patch":
      return { ...state, ...action.values };
    default:
      return state;
  }
}

export function CreateTaskDialog({
  open,
  profiles,
  busy,
  onOpenChange,
  onCreate,
}: CreateTaskDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <CreateTaskDialogContent
          busy={busy}
          onCreate={onCreate}
          onOpenChange={onOpenChange}
          profiles={profiles}
        />
      ) : null}
    </Dialog>
  );
}

function CreateTaskDialogContent({
  profiles,
  busy,
  onOpenChange,
  onCreate,
}: {
  profiles: ProfileSummary[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: CreateTaskDialogProps["onCreate"];
}) {
  const [form, dispatch] = useReducer(
    createTaskFormReducer,
    profiles,
    createInitialFormState
  );
  const draftPromptMutation = useDraftTaskPromptMutation();
  const generating = draftPromptMutation.isPending;

  async function handleSubmit() {
    await onCreate({
      description: form.description,
      profileId: form.profileId,
      prompt: form.prompt,
      title: form.title,
    });
    dispatch({ profiles, type: "reset" });
    onOpenChange(false);
  }

  async function handleGeneratePrompt() {
    const trimmedTitle = form.title.trim();

    if (!trimmedTitle) {
      return;
    }

    dispatch({ type: "patch", values: { generateError: null } });

    try {
      const generated = await draftPromptMutation.mutateAsync({
        description: form.description.trim() || undefined,
        title: trimmedTitle,
      });
      dispatch({
        type: "patch",
        values: { prompt: normalizeTaskPrompt(generated) },
      });
    } catch (error) {
      dispatch({
        type: "patch",
        values: { generateError: formatError(error) },
      });
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Create task</DialogTitle>
        <DialogDescription>
          Add a work item for an agent profile. Move it to To Do and press play
          on the card to run.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2.5">
          <label className="block font-medium text-sm" htmlFor="task-title">
            Title
          </label>
          <Input
            id="task-title"
            onChange={(event) =>
              dispatch({ type: "patch", values: { title: event.target.value } })
            }
            placeholder="Research competitors"
            value={form.title}
          />
        </div>

        <div className="space-y-2.5">
          <label
            className="block font-medium text-sm"
            htmlFor="task-description"
          >
            Description
          </label>
          <Input
            id="task-description"
            onChange={(event) =>
              dispatch({
                type: "patch",
                values: { description: event.target.value },
              })
            }
            placeholder="Optional context for the board"
            value={form.description}
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="block font-medium text-sm" htmlFor="task-prompt">
              Agent prompt
            </label>
            <Button
              disabled={generating || !form.title.trim()}
              onClick={() => void handleGeneratePrompt()}
              size="sm"
              type="button"
              variant="outline"
            >
              {generating ? (
                <Spinner className="size-3.5" />
              ) : (
                <SparklesIcon aria-hidden className="size-3.5" />
              )}
              Generate
            </Button>
          </div>
          <Textarea
            id="task-prompt"
            onChange={(event) =>
              dispatch({
                type: "patch",
                values: { prompt: event.target.value },
              })
            }
            placeholder="Find the top 5 competitors and summarize their positioning"
            rows={4}
            value={form.prompt}
          />
          {form.generateError ? (
            <p className="text-red-700 text-sm dark:text-red-300">
              {form.generateError}
            </p>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <label className="block font-medium text-sm" htmlFor="task-profile">
            Profile
          </label>
          <Select
            onValueChange={(value) => {
              if (value) {
                dispatch({ type: "patch", values: { profileId: value } });
              }
            }}
            value={form.profileId}
          >
            <SelectTrigger id="task-profile">
              <SelectValue placeholder="Select profile">
                {
                  profiles.find((profile) => profile.id === form.profileId)
                    ?.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  <span className="flex items-center gap-2">
                    <ProfileAvatar profile={profile} size="sm" />
                    <span>{profile.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={
            busy || generating || !form.title.trim() || !form.prompt.trim()
          }
          onClick={() => void handleSubmit()}
          type="button"
        >
          Create task
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
