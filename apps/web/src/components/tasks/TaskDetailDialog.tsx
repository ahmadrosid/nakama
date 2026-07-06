import type { ProfileSummary, StoredTask } from "@nakama/core/contract";
import { PlayIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
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

export function TaskDetailDialog({
  task,
  profiles,
  busy,
  onOpenChange,
  onSave,
  onDelete,
  onRun,
}: TaskDetailDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [profileId, setProfileId] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const draftPromptMutation = useDraftTaskPromptMutation();
  const generating = draftPromptMutation.isPending;
  const actionsBusy = busy || generating;

  useEffect(() => {
    if (!task) {
      return;
    }

    setTitle(task.title);
    setDescription(task.description);
    setPrompt(task.prompt);
    setProfileId(task.profileId);
    setGenerateError(null);
  }, [task]);

  async function handleGeneratePrompt() {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    setGenerateError(null);

    try {
      const generated = await draftPromptMutation.mutateAsync({
        title: trimmedTitle,
        description: description.trim() || undefined,
      });
      setPrompt(normalizeTaskPrompt(generated));
    } catch (error) {
      setGenerateError(formatError(error));
    }
  }

  if (!task) {
    return null;
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
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
            <Input id="detail-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div className="space-y-2.5">
            <label className="block text-sm font-medium" htmlFor="detail-description">
              Description
            </label>
            <Input
              id="detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
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
                disabled={actionsBusy || !title.trim()}
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
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
            />
            {generateError ? (
              <p className="text-sm text-red-700 dark:text-red-300">{generateError}</p>
            ) : null}
          </div>

          <div className="space-y-2.5">
            <label className="block text-sm font-medium" htmlFor="detail-profile">
              Profile
            </label>
            <Select
              value={profileId}
              onValueChange={(value) => {
                if (value) {
                  setProfileId(value);
                }
              }}
            >
              <SelectTrigger id="detail-profile">
                <SelectValue placeholder="Select profile">
                  {profiles.find((profile) => profile.id === profileId)?.name}
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
              onClick={() => void onSave({ title, description, prompt, profileId })}
            >
              Save changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
