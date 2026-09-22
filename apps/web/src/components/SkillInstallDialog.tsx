import type { InstallSkillRequest } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { type ChangeEvent, type SubmitEvent, useState } from "react";
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
  const [method, setMethod] = useState<"command" | "github" | "upload">(
    "github"
  );
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [zip, setZip] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit =
    (method === "command" && command.trim().length > 0) ||
    (method === "github" && url.trim().length > 0) ||
    (method === "upload" && zip !== null);

  function handleZipChange(event: ChangeEvent<HTMLInputElement>) {
    setZip(event.target.files?.[0] ?? null);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || busy || !profileId) {
      return;
    }

    setSubmitError(null);

    try {
      if (method === "upload" && zip) {
        const bytes = new Uint8Array(await zip.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 32_768) {
          binary += String.fromCharCode(
            ...bytes.subarray(index, index + 32_768)
          );
        }
        await onSubmit({ profileId, zipBase64: btoa(binary) });
      } else if (method === "command") {
        await onSubmit({ command: command.trim(), profileId });
      } else {
        await onSubmit({ profileId, url: url.trim() });
      }
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
          <DialogTitle>Add skill</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2" role="tablist">
          {[
            ["github", "GitHub URL"],
            ["command", "npx command"],
            ["upload", "Upload ZIP"],
          ].map(([value, label]) => (
            <Button
              key={value}
              onClick={() => setMethod(value as typeof method)}
              role="tab"
              type="button"
              variant={method === value ? "default" : "outline"}
            >
              {label}
            </Button>
          ))}
        </div>

        {method === "github" ? (
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
              placeholder="https://github.com/org/repo/tree/main/skills/example"
              value={url}
            />
          </div>
        ) : null}

        {method === "command" ? (
          <div className="space-y-2.5">
            <label
              className="block font-medium text-foreground text-sm"
              htmlFor="skill-install-command"
            >
              npx skills add command
            </label>
            <Input
              autoFocus
              disabled={busy}
              id="skill-install-command"
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npx skills add vercel-labs/agent-skills --skill pdf"
              value={command}
            />
          </div>
        ) : null}

        {method === "upload" ? (
          <div className="space-y-2.5">
            <label
              className="block font-medium text-foreground text-sm"
              htmlFor="skill-install-zip"
            >
              ZIP file
            </label>
            <Input
              accept=".zip,application/zip"
              autoFocus
              disabled={busy}
              id="skill-install-zip"
              onChange={handleZipChange}
              type="file"
            />
          </div>
        ) : null}

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
