import type { ProfileSummary, StoredTask } from "@nakama/core/contract";
import { normalizeTaskPrompt } from "@nakama/core/normalize-task-prompt";
import { Delete02Icon, PlayIcon, SparklesIcon } from "hugeicons-react";
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

interface TaskDetailDialogProps {
  busy: boolean;
  onDelete: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onRun: () => Promise<void>;
  onSave: (input: {
    title: string;
    description: string;
    prompt: string;
    profileId: string;
  }) => Promise<void>;
  profiles: ProfileSummary[];
  task: StoredTask | null;
}

type TaskDetailFormState = {
  title: string;
  description: string;
  prompt: string;
  profileId: string;
  generateError: string | null;
  /** Delete asks once before it runs; a task and its run history do not come back. */
  confirmingDelete: boolean;
};

type TaskDetailFormAction =
  | { type: "sync"; task: StoredTask }
  | { type: "patch"; values: Partial<TaskDetailFormState> }
  | { type: "askDelete" }
  | { type: "cancelDelete" };

export function createFormStateFromTask(task: StoredTask): TaskDetailFormState {
  return {
    confirmingDelete: false,
    description: task.description,
    generateError: null,
    profileId: task.profileId,
    prompt: task.prompt,
    title: task.title,
  };
}

/**
 * Which controls the footer offers. While the delete confirmation is open the
 * dialog offers nothing else, so a mis-click cannot run or save the task while
 * that decision is still on screen.
 */
export function taskDetailFooterActions(state: { confirmingDelete: boolean }): {
  showConfirmDelete: boolean;
  showDelete: boolean;
  showRunAndSave: boolean;
} {
  return {
    showConfirmDelete: state.confirmingDelete,
    showDelete: !state.confirmingDelete,
    showRunAndSave: !state.confirmingDelete,
  };
}

export function taskDetailFormReducer(
  state: TaskDetailFormState,
  action: TaskDetailFormAction
): TaskDetailFormState {
  switch (action.type) {
    case "sync":
      return createFormStateFromTask(action.task);
    case "patch":
      return { ...state, ...action.values };
    case "askDelete":
      return { ...state, confirmingDelete: true };
    case "cancelDelete":
      return { ...state, confirmingDelete: false };
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
    <Dialog onOpenChange={onOpenChange} open={Boolean(task)}>
      <TaskDetailDialogContent
        busy={busy}
        key={task.id}
        onDelete={onDelete}
        onRun={onRun}
        onSave={onSave}
        profiles={profiles}
        task={task}
      />
    </Dialog>
  );
}

function TaskDetailDialogContent({
  task,
  profiles,
  busy,
  onSave,
  onDelete,
  onRun,
}: {
  task: StoredTask;
  profiles: ProfileSummary[];
  busy: boolean;
  onSave: TaskDetailDialogProps["onSave"];
  onDelete: TaskDetailDialogProps["onDelete"];
  onRun: TaskDetailDialogProps["onRun"];
}) {
  const [form, dispatch] = useReducer(
    taskDetailFormReducer,
    task,
    createFormStateFromTask
  );
  const draftPromptMutation = useDraftTaskPromptMutation();
  const generating = draftPromptMutation.isPending;
  const actionsBusy = busy || generating;
  const footer = taskDetailFooterActions(form);

  async function handleDelete() {
    try {
      await onDelete();
    } catch {
      // The page surfaces the failure. Leave the confirmation up so the delete
      // can be retried or dismissed, and never settle state on a dialog that a
      // successful delete has already unmounted.
    }
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
        <DialogTitle>Task details</DialogTitle>
        <DialogDescription>
          Status: {task.status.replace("_", " ")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2.5">
          <label className="block font-medium text-sm" htmlFor="detail-title">
            Title
          </label>
          <Input
            id="detail-title"
            onChange={(event) =>
              dispatch({ type: "patch", values: { title: event.target.value } })
            }
            value={form.title}
          />
        </div>

        <div className="space-y-2.5">
          <label
            className="block font-medium text-sm"
            htmlFor="detail-description"
          >
            Description
          </label>
          <Input
            id="detail-description"
            onChange={(event) =>
              dispatch({
                type: "patch",
                values: { description: event.target.value },
              })
            }
            value={form.description}
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label
              className="block font-medium text-sm"
              htmlFor="detail-prompt"
            >
              Agent prompt
            </label>
            <Button
              disabled={actionsBusy || !form.title.trim()}
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
            id="detail-prompt"
            onChange={(event) =>
              dispatch({
                type: "patch",
                values: { prompt: event.target.value },
              })
            }
            rows={5}
            value={form.prompt}
          />
          {form.generateError ? (
            <p className="text-red-700 text-sm dark:text-red-300">
              {form.generateError}
            </p>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <label className="block font-medium text-sm" htmlFor="detail-profile">
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
            <SelectTrigger id="detail-profile">
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

      <DialogFooter className="gap-2 sm:justify-between">
        {footer.showDelete ? (
          <Button
            disabled={actionsBusy}
            onClick={() => dispatch({ type: "askDelete" })}
            type="button"
            variant="destructive"
          >
            <Delete02Icon aria-hidden className="size-4" />
            Delete
          </Button>
        ) : null}

        {footer.showConfirmDelete ? (
          <>
            <Button
              disabled={actionsBusy}
              onClick={() => dispatch({ type: "cancelDelete" })}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={actionsBusy}
              onClick={() => void handleDelete()}
              type="button"
              variant="destructive"
            >
              {busy ? (
                <Spinner className="size-4" />
              ) : (
                <Delete02Icon aria-hidden className="size-4" />
              )}
              Delete task
            </Button>
          </>
        ) : null}

        {footer.showRunAndSave ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={actionsBusy}
              onClick={() => void onRun()}
              type="button"
              variant="outline"
            >
              {busy ? (
                <Spinner className="size-4" />
              ) : (
                <PlayIcon aria-hidden className="size-4" />
              )}
              Run agent
            </Button>
            <Button
              disabled={actionsBusy}
              onClick={() =>
                void onSave({
                  description: form.description,
                  profileId: form.profileId,
                  prompt: form.prompt,
                  title: form.title,
                })
              }
              type="button"
            >
              Save changes
            </Button>
          </div>
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}
