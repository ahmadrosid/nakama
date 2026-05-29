import type { ProfileSummary } from "@tinyclaw/core/contract";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
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
import { normalizeTaskPrompt } from "@tinyclaw/core/normalize-task-prompt";
import { formatError } from "@/lib/client";
import { DEFAULT_PROFILE_ID } from "@/lib/profiles";

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

export function CreateTaskDialog({
  open,
  profiles,
  busy,
  onOpenChange,
  onCreate,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [profileId, setProfileId] = useState(DEFAULT_PROFILE_ID);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const draftPromptMutation = useDraftTaskPromptMutation();
  const selectedProfileName = profiles.find((profile) => profile.id === profileId)?.name;
  const generating = draftPromptMutation.isPending;

  async function handleSubmit() {
    await onCreate({ title, description, prompt, profileId });
    setTitle("");
    setDescription("");
    setPrompt("");
    setProfileId(DEFAULT_PROFILE_ID);
    setGenerateError(null);
    onOpenChange(false);
  }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Research competitors"
            />
          </div>

          <div className="space-y-2.5">
            <label className="block text-sm font-medium" htmlFor="task-description">
              Description
            </label>
            <Input
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
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
                disabled={generating || !title.trim()}
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
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Find the top 5 competitors and summarize their positioning"
              rows={4}
            />
            {generateError ? (
              <p className="text-sm text-red-700 dark:text-red-300">{generateError}</p>
            ) : null}
          </div>

          <div className="space-y-2.5">
            <label className="block text-sm font-medium" htmlFor="task-profile">
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
              <SelectTrigger id="task-profile">
                <SelectValue placeholder="Select profile">{selectedProfileName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
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
            disabled={busy || generating || !title.trim() || !prompt.trim()}
            onClick={() => void handleSubmit()}
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
