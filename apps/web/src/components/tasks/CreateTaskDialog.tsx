import type { ProfileSummary } from "@nakama/core/contract";
import { SparklesIcon } from "lucide-react";
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
import { normalizeTaskPrompt } from "@nakama/core/normalize-task-prompt";
import { formatError } from "@/lib/client";
import { resolveInitialProfileId } from "@/lib/profiles";

interface CreateTaskDialogProps {
  open: boolean;
  profiles: ProfileSummary[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title: string;
    description: string;
    prompt: string;
    profileId: string;
  }) => Promise<void>;
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

function createInitialFormState(profiles: ProfileSummary[]): CreateTaskFormState {
  return {
    title: "",
    description: "",
    prompt: "",
    profileId: resolveInitialProfileId(profiles),
    generateError: null,
  };
}

function createTaskFormReducer(
  state: CreateTaskFormState,
  action: CreateTaskFormAction,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <CreateTaskDialogContent
          profiles={profiles}
          busy={busy}
          onOpenChange={onOpenChange}
          onCreate={onCreate}
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
    createInitialFormState,
  );
  const draftPromptMutation = useDraftTaskPromptMutation();
  const generating = draftPromptMutation.isPending;

  async function handleSubmit() {
    await onCreate({
      title: form.title,
      description: form.description,
      prompt: form.prompt,
      profileId: form.profileId,
    });
    dispatch({ type: "reset", profiles });
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
        title: trimmedTitle,
        description: form.description.trim() || undefined,
      });
      dispatch({ type: "patch", values: { prompt: normalizeTaskPrompt(generated) } });
    } catch (error) {
      dispatch({ type: "patch", values: { generateError: formatError(error) } });
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Create task</DialogTitle>
        <DialogDescription>
          Add a work item for an agent profile. Move it to To Do and press play on the card to
          run.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2.5">
          <label className="block text-sm font-medium" htmlFor="task-title">
            Title
          </label>
          <Input
            id="task-title"
            value={form.title}
            onChange={(event) =>
              dispatch({ type: "patch", values: { title: event.target.value } })
            }
            placeholder="Research competitors"
          />
        </div>

        <div className="space-y-2.5">
          <label className="block text-sm font-medium" htmlFor="task-description">
            Description
          </label>
          <Input
            id="task-description"
            value={form.description}
            onChange={(event) =>
              dispatch({ type: "patch", values: { description: event.target.value } })
            }
            placeholder="Optional context for the board"
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium" htmlFor="task-prompt">
              Agent prompt
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={generating || !form.title.trim()}
              onClick={() => void handleGeneratePrompt()}
            >
              {generating ? (
                <Spinner className="size-3.5" />
              ) : (
                <SparklesIcon className="size-3.5" aria-hidden />
              )}
              Generate
            </Button>
          </div>
          <Textarea
            id="task-prompt"
            value={form.prompt}
            onChange={(event) =>
              dispatch({ type: "patch", values: { prompt: event.target.value } })
            }
            placeholder="Find the top 5 competitors and summarize their positioning"
            rows={4}
          />
          {form.generateError ? (
            <p className="text-sm text-red-700 dark:text-red-300">{form.generateError}</p>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <label className="block text-sm font-medium" htmlFor="task-profile">
            Profile
          </label>
          <Select
            value={form.profileId}
            onValueChange={(value) => {
              if (value) {
                dispatch({ type: "patch", values: { profileId: value } });
              }
            }}
          >
            <SelectTrigger id="task-profile">
              <SelectValue placeholder="Select profile">
                {profiles.find((profile) => profile.id === form.profileId)?.name}
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
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || generating || !form.title.trim() || !form.prompt.trim()}
          onClick={() => void handleSubmit()}
        >
          Create task
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
