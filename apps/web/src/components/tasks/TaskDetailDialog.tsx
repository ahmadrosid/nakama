import type { ProfileSummary, StoredTask } from "@nakama/core/contract";
import { PlayIcon, SparklesIcon, Trash2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useDraftTaskPromptMutation } from "@/hooks/use-tasks";
import { normalizeTaskPrompt } from "@nakama/core/normalize-task-prompt";
import { formatError } from "@/lib/client";

interface TaskDetailDialogProps {
  task: StoredTask | null;
  profiles: ProfileSummary[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    title: string;
    description: string;
    prompt: string;
    profileId: string;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onRun: () => Promise<void>;
}

type TaskDetailFormState = {
  title: string;
  description: string;
  prompt: string;
  profileId: string;
  generateError: string | null;
};

type TaskDetailFormAction =
  | { type: "sync"; task: StoredTask }
  | { type: "patch"; values: Partial<TaskDetailFormState> };

function createFormStateFromTask(task: StoredTask): TaskDetailFormState {
  return {
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    profileId: task.profileId,
    generateError: null,
  };
}

function taskDetailFormReducer(
  state: TaskDetailFormState,
  action: TaskDetailFormAction,
): TaskDetailFormState {
  switch (action.type) {
    case "sync":
      return createFormStateFromTask(action.task);
    case "patch":
      return { ...state, ...action.values };
    default:
      return state;
  }
}

export function TaskDetailDialog({
  task,
  profiles,
  busy,
  onOpenChange,
  onSave,
  onDelete,
  onRun,
}: TaskDetailDialogProps) {
  if (!task) {
    return null;
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <TaskDetailDialogContent
        key={task.id}
        task={task}
        profiles={profiles}
        busy={busy}
        onOpenChange={onOpenChange}
        onSave={onSave}
        onDelete={onDelete}
        onRun={onRun}
      />
    </Dialog>
  );
}

function TaskDetailDialogContent({
  task,
  profiles,
  busy,
  onOpenChange,
  onSave,
  onDelete,
  onRun,
}: {
  task: StoredTask;
  profiles: ProfileSummary[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: TaskDetailDialogProps["onSave"];
  onDelete: TaskDetailDialogProps["onDelete"];
  onRun: TaskDetailDialogProps["onRun"];
}) {
  const [form, dispatch] = useReducer(taskDetailFormReducer, task, createFormStateFromTask);
  const draftPromptMutation = useDraftTaskPromptMutation();
  const generating = draftPromptMutation.isPending;
  const actionsBusy = busy || generating;

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
        <DialogTitle>Task details</DialogTitle>
        <DialogDescription>
          Status: {task.status.replace("_", " ")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2.5">
          <label className="block text-sm font-medium" htmlFor="detail-title">
            Title
          </label>
          <Input
            id="detail-title"
            value={form.title}
            onChange={(event) =>
              dispatch({ type: "patch", values: { title: event.target.value } })
            }
          />
        </div>

        <div className="space-y-2.5">
          <label className="block text-sm font-medium" htmlFor="detail-description">
            Description
          </label>
          <Input
            id="detail-description"
            value={form.description}
            onChange={(event) =>
              dispatch({ type: "patch", values: { description: event.target.value } })
            }
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium" htmlFor="detail-prompt">
              Agent prompt
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionsBusy || !form.title.trim()}
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
            id="detail-prompt"
            value={form.prompt}
            onChange={(event) =>
              dispatch({ type: "patch", values: { prompt: event.target.value } })
            }
            rows={5}
          />
          {form.generateError ? (
            <p className="text-sm text-red-700 dark:text-red-300">{form.generateError}</p>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <label className="block text-sm font-medium" htmlFor="detail-profile">
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
            <SelectTrigger id="detail-profile">
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

      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          type="button"
          variant="destructive"
          disabled={actionsBusy}
          onClick={() => void onDelete()}
        >
          <Trash2Icon className="size-4" aria-hidden />
          Delete
        </Button>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={actionsBusy} onClick={() => void onRun()}>
            {busy ? <Spinner className="size-4" /> : <PlayIcon className="size-4" aria-hidden />}
            Run agent
          </Button>
          <Button
            type="button"
            disabled={actionsBusy}
            onClick={() =>
              void onSave({
                title: form.title,
                description: form.description,
                prompt: form.prompt,
                profileId: form.profileId,
              })
            }
          >
            Save changes
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
