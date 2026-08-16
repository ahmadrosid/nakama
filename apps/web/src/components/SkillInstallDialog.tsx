import type { InstallSkillRequest } from "@nakama/core/contract";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatError } from "@/lib/client";

interface SkillInstallDialogProps {
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: InstallSkillRequest) => Promise<void>;
  open: boolean;
  profileId: string | null;
}

export function SkillInstallDialog({
  open,
  busy,
  profileId,
  onOpenChange,
  onSubmit,
}: SkillInstallDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open ? (
        <SkillInstallDialogContent
          busy={busy}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          profileId={profileId}
        />
      ) : null}
    </Dialog>
  );
}

function SkillInstallDialogContent({
  busy,
  profileId,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  profileId: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: InstallSkillRequest) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = url.trim().length > 0;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || busy || !profileId) {
      return;
    }

    setSubmitError(null);

    try {
      await onSubmit({
        profileId,
        url: url.trim(),
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : formatError(error)
      );
    }
  }

  return (
    <DialogContent className="gap-6 p-6 sm:max-w-lg">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <DialogHeader className="gap-2">
          <DialogTitle>Install from GitHub</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          <label
            className="block font-medium text-foreground text-sm"
            htmlFor="skill-install-url"
          >
            GitHub URL
          </label>
          <Input
            autoFocus
            disabled={busy}
            id="skill-install-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/org/repo/blob/main/skills/example/SKILL.md"
            value={url}
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
            {busy ? <Spinner className="size-4" /> : "Install skill"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
