import type { CreateSkillRequest } from "@nakama/core/contract";
import { useEffect, useState, type FormEvent } from "react";
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
  open: boolean;
  busy: boolean;
  profileId: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateSkillRequest) => Promise<void>;
}

const defaultBody = `# Skill instructions

Describe when the agent should use this skill and what steps to follow.
`;

export function SkillCreateDialog({
  open,
  busy,
  profileId,
  onOpenChange,
  onSubmit,
}: SkillCreateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(defaultBody);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    setName("");
    setDescription("");
    setBody(defaultBody);
    setSubmitError(null);
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!canSubmit || busy || !profileId) {
      return;
    }

    setSubmitError(null);

    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        body: body.trim() || undefined,
        profileId,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : formatError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 p-6 sm:max-w-2xl">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <DialogHeader className="gap-2">
            <DialogTitle>Add skill</DialogTitle>
            <DialogDescription>
              Create a workflow skill for this profile. It is saved under{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                ~/.nakama/profiles/&lt;profile&gt;/skills/
              </code>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2.5">
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="skill-create-name"
              >
                Name
              </label>
              <Input
                id="skill-create-name"
                value={name}
                disabled={busy}
                autoFocus
                className="font-mono text-sm"
                placeholder="weather"
                onChange={(event) => setName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="space-y-2.5">
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="skill-create-description"
              >
                Description
              </label>
              <Input
                id="skill-create-description"
                value={description}
                disabled={busy}
                placeholder="Get weather forecasts. Use when the user asks about weather."
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="space-y-2.5">
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="skill-create-body"
              >
                Instructions
              </label>
              <Textarea
                id="skill-create-body"
                value={body}
                disabled={busy}
                rows={8}
                className="min-h-40 max-h-64 overflow-y-auto font-mono text-sm"
                onChange={(event) => setBody(event.target.value)}
              />
            </div>

            {submitError ? (
              <p
                className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                role="alert"
              >
                {submitError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !canSubmit || !profileId}>
              {busy ? <Spinner className="size-4" /> : "Add skill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
