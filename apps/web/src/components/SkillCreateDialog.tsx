import type { CreateSkillRequest } from "@nakama/core/contract";
import { type SubmitEvent, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatError } from "@/lib/client";

interface SkillCreateDialogProps {
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateSkillRequest) => Promise<void>;
  open: boolean;
  profileId: string | null;
}

const bodyPlaceholder = `# Skill instructions

Describe when the agent should use this skill and what steps to follow.`;

export function SkillCreateDialog({
  open,
  busy,
  profileId,
  onOpenChange,
  onSubmit,
}: SkillCreateDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <SkillCreateDialogContent
          busy={busy}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          profileId={profileId}
        />
      ) : null}
    </Dialog>
  );
}

function SkillCreateDialogContent({
  busy,
  profileId,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  profileId: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateSkillRequest) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || busy || !profileId) {
      return;
    }

    setSubmitError(null);

    try {
      await onSubmit({
        body: body.trim() || undefined,
        description: description.trim(),
        name: name.trim(),
        profileId,
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : formatError(error)
      );
    }
  }

  return (
    <DialogContent className="gap-6 p-6 sm:max-w-2xl">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <DialogHeader className="gap-2">
          <DialogTitle>Create skill</DialogTitle>
          <DialogDescription>
            Create a workflow skill for this profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2.5">
            <label
              className="block font-medium text-foreground text-sm"
              htmlFor="skill-create-name"
            >
              Name
            </label>
            <Input
              autoFocus
              className="font-mono text-sm"
              disabled={busy}
              id="skill-create-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="weather"
              value={name}
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          <div className="space-y-2.5">
            <label
              className="block font-medium text-foreground text-sm"
              htmlFor="skill-create-description"
            >
              Description
            </label>
            <Input
              disabled={busy}
              id="skill-create-description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Get weather forecasts. Use when the user asks about weather."
              value={description}
            />
          </div>

          <div className="space-y-2.5">
            <label
              className="block font-medium text-foreground text-sm"
              htmlFor="skill-create-body"
            >
              Instructions
            </label>
            <Textarea
              className="max-h-64 min-h-40 overflow-y-auto font-mono text-sm"
              disabled={busy}
              id="skill-create-body"
              onChange={(event) => setBody(event.target.value)}
              placeholder={bodyPlaceholder}
              rows={8}
              value={body}
            />
          </div>

          {submitError ? (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2.5 text-destructive text-sm"
              role="alert"
            >
              {submitError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-3 border-t-0 bg-transparent pt-0 sm:justify-end">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={busy || !canSubmit || !profileId} type="submit">
            {busy ? <Spinner className="size-4" /> : "Create skill"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
