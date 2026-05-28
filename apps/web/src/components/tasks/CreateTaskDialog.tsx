import type { ProfileSummary } from "@tinyclaw/core/contract";
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
import { Textarea } from "@/components/ui/textarea";
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

  async function handleSubmit() {
    await onCreate({ title, description, prompt, profileId });
    setTitle("");
    setDescription("");
    setPrompt("");
    setProfileId(DEFAULT_PROFILE_ID);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create task</DialogTitle>
          <DialogDescription>
            Add a work item for an agent profile. Drag it to In Progress to run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="task-title">
              Title
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Research competitors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="task-description">
              Description
            </label>
            <Input
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context for the board"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="task-prompt">
              Agent prompt
            </label>
            <Textarea
              id="task-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Find the top 5 competitors and summarize their positioning"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="task-profile">
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
                <SelectValue placeholder="Select profile" />
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
            disabled={busy || !title.trim() || !prompt.trim()}
            onClick={() => void handleSubmit()}
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
