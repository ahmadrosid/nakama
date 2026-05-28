import type { StoredTask, TaskRunRecord } from "@tinyclaw/core/contract";
import {
  CheckCircle2Icon,
  Loader2Icon,
  PlayIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
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
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { formatSessionTimestamp } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

interface TaskDetailDialogProps {
  task: StoredTask | null;
  runs: TaskRunRecord[];
  runsLoading: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    title: string;
    description: string;
    prompt: string;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onRun: () => Promise<void>;
}

export function TaskDetailDialog({
  task,
  runs,
  runsLoading,
  busy,
  onOpenChange,
  onSave,
  onDelete,
  onRun,
}: TaskDetailDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!task) {
      return;
    }

    setTitle(task.title);
    setDescription(task.description);
    setPrompt(task.prompt);
  }, [task]);

  if (!task) {
    return null;
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Task details</DialogTitle>
          <DialogDescription>
            Status: {task.status.replace("_", " ")} · Profile: {task.profileId}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="detail-title">
              Title
            </label>
            <Input id="detail-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="detail-description">
              Description
            </label>
            <Input
              id="detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="detail-prompt">
              Agent prompt
            </label>
            <Textarea
              id="detail-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
            />
          </div>

          <section className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Run history</h3>
              {runsLoading ? <Spinner className="size-4" /> : null}
            </div>

            {runs.length === 0 && !runsLoading ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <ul className="space-y-2">
                {runs.map((run) => (
                  <li key={run.id} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <RunStatusIcon status={run.status} />
                      <span className="capitalize">{run.status}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {formatSessionTimestamp(run.startedAt)}
                      </span>
                    </div>
                    {run.output ? (
                      <div className="mt-2 text-sm">
                        <MessageResponse>{run.output}</MessageResponse>
                      </div>
                    ) : null}
                    {run.error ? (
                      <p className="mt-2 text-sm text-red-700 dark:text-red-300">{run.error}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void onDelete()}>
            <Trash2Icon className="size-4" aria-hidden />
            Delete
          </Button>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void onRun()}>
              {busy ? <Spinner className="size-4" /> : <PlayIcon className="size-4" aria-hidden />}
              Run agent
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void onSave({ title, description, prompt })}
            >
              Save changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunStatusIcon({ status }: { status: TaskRunRecord["status"] }) {
  if (status === "running") {
    return <Loader2Icon className="size-4 animate-spin text-primary" aria-hidden />;
  }

  if (status === "completed") {
    return <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden />;
  }

  return <XCircleIcon className={cn("size-4 text-red-600")} aria-hidden />;
}
