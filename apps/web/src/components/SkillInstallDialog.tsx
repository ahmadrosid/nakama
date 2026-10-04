import type { InstallSkillRequest, SkillSummary } from "@nakama/core/contract";
import {
  BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
} from "@nakama/core/skills/bundled-names";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { Delete02Icon } from "hugeicons-react";
import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useAuth } from "@/context/use-auth";
import {
  useAgentBrowserSettings,
  useInstallAgentBrowser,
} from "@/hooks/use-agent-browser-settings";
import { isPluginOwned } from "@/hooks/use-plugins";
import { formatError } from "@/lib/client";

const bundledNames = new Set<string>(BUNDLED_SKILL_NAMES);
const runtimeOnlyNames = new Set<string>(RUNTIME_ONLY_BUNDLED_SKILL_NAMES);

interface AddSkillDialogProps {
  assignedSkillIds: ReadonlySet<string>;
  bashAssigned: boolean;
  busy: boolean;
  onAssign: (skillId: string) => Promise<void>;
  onAssignBash: () => Promise<void>;
  onDelete?: (skillId: string) => Promise<void>;
  onInstall: (request: InstallSkillRequest) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  orgId: string | null;
  profileId: string | null;
  skills: SkillSummary[];
  skillsError: unknown;
  skillsLoading: boolean;
}

export function AddSkillDialog({
  open,
  busy,
  profileId,
  orgId,
  onOpenChange,
  onInstall,
  onAssign,
  onAssignBash,
  onDelete,
  skills,
  assignedSkillIds,
  bashAssigned,
  skillsLoading,
  skillsError,
}: AddSkillDialogProps) {
  const [running, setRunning] = useState(false);
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!(busy || running)) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      {open ? (
        <AddSkillDialogContent
          assignedSkillIds={assignedSkillIds}
          bashAssigned={bashAssigned}
          busy={busy}
          key={`${orgId}:${profileId}`}
          onAssign={onAssign}
          onAssignBash={onAssignBash}
          onDelete={onDelete}
          onInstall={onInstall}
          onOpenChange={onOpenChange}
          open={open}
          orgId={orgId}
          profileId={profileId}
          running={running}
          setRunning={setRunning}
          skills={skills}
          skillsError={skillsError}
          skillsLoading={skillsLoading}
        />
      ) : null}
    </Dialog>
  );
}

function OrganizationSkills({
  assignedSkillIds,
  bashAssigned,
  disabled,
  onAssign,
  onAssignBash,
  onDelete,
  onOpenChange,
  orgId,
  profileId,
  setRunning,
  skills,
  skillsError,
  skillsLoading,
}: Pick<
  AddSkillDialogProps,
  | "assignedSkillIds"
  | "bashAssigned"
  | "onAssign"
  | "onAssignBash"
  | "onDelete"
  | "onOpenChange"
  | "orgId"
  | "profileId"
  | "skills"
  | "skillsError"
  | "skillsLoading"
> & {
  disabled: boolean;
  setRunning: (running: boolean) => void;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillSummary | null>(null);
  const [installProgress, setInstallProgress] = useState<string | null>(null);
  const { data: browserStatus } = useAgentBrowserSettings(
    skills.some((skill) => skill.name === "agent-browser")
  );
  const browserInstall = useInstallAgentBrowser();
  const busy = disabled || browserInstall.isPending;
  const visibleSkills = skills.filter(
    (skill) =>
      !runtimeOnlyNames.has(skill.name) &&
      (skill.orgId == null || skill.orgId === orgId)
  );
  const results = visibleSkills.filter((skill) =>
    `${skill.name} ${skill.description}`
      .toLowerCase()
      .includes(search.toLowerCase().trim())
  );
  const browserNeedsInstall = browserStatus?.ready !== true;

  function isAdded(skillId: string) {
    return assignedSkillIds.has(skillId) || added.has(skillId);
  }

  function toggle(skillId: string) {
    if (busy || isAdded(skillId)) {
      return;
    }
    setSelected((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    );
    setError(null);
  }

  async function addSelected() {
    if (busy || !profileId || selected.length === 0) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      for (const skillId of selected) {
        if (isAdded(skillId)) {
          setSelected((current) => current.filter((id) => id !== skillId));
          continue;
        }
        await onAssign(skillId);
        setAdded((current) => new Set([...current, skillId]));
        setSelected((current) => current.filter((id) => id !== skillId));
      }
      onOpenChange(false);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setRunning(false);
    }
  }

  async function confirmDelete() {
    if (!(pendingDelete && onDelete) || busy) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      await onDelete(pendingDelete.id);
      setSelected((current) => current.filter((id) => id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setRunning(false);
    }
  }

  async function addBash() {
    if (busy) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      await onAssignBash();
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setRunning(false);
    }
  }

  async function installBrowser() {
    if (busy || !bashAssigned || user?.isPlatformAdmin !== true) {
      return;
    }
    setRunning(true);
    setError(null);
    setInstallProgress(null);
    try {
      const status = await browserInstall.mutateAsync({
        onProgress: setInstallProgress,
      });
      if (!status.ready) {
        setError(status.statusMessage ?? "agent-browser is not ready.");
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setRunning(false);
      setInstallProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      {pendingDelete ? (
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle>Delete skill?</DialogTitle>
            <DialogDescription>
              Delete "{pendingDelete.name}" from the library? This removes it
              from every profile.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setPendingDelete(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void confirmDelete()}
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <>
          <Input
            aria-label="Search skills"
            disabled={busy}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills..."
            value={search}
          />
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {skillsLoading ? (
              <p className="p-4 text-muted-foreground text-sm">
                Loading skills...
              </p>
            ) : null}
            {!skillsLoading && skillsError ? (
              <p className="p-4 text-destructive text-sm" role="alert">
                Could not load skills. Try again.
              </p>
            ) : null}
            {!(skillsLoading || skillsError) && visibleSkills.length === 0 ? (
              <p className="p-4 text-muted-foreground text-sm">
                No organization skills yet. Use Install new.
              </p>
            ) : null}
            {!(skillsLoading || skillsError) &&
            visibleSkills.length > 0 &&
            results.length === 0 ? (
              <p className="p-4 text-muted-foreground text-sm">
                No skills found.
              </p>
            ) : null}
            {skillsLoading || skillsError
              ? null
              : results.map((skill) => {
                  const onProfile = isAdded(skill.id);
                  const isBrowser = skill.name === "agent-browser";
                  const needsBash = isBrowser && !bashAssigned;
                  const needsInstall = isBrowser && browserNeedsInstall;
                  const unavailable = onProfile || needsBash || needsInstall;
                  const canDelete = Boolean(
                    onDelete &&
                      user?.isPlatformAdmin &&
                      !bundledNames.has(skill.name) &&
                      !isPluginOwned(skill)
                  );
                  return (
                    <div
                      className="flex items-center gap-3 border-border border-b px-3 py-3 last:border-b-0"
                      key={skill.id}
                    >
                      <label className="flex min-w-0 flex-1 items-start gap-3">
                        <input
                          aria-label={`Add ${skill.name}`}
                          checked={selected.includes(skill.id) || onProfile}
                          className="mt-1"
                          disabled={busy || unavailable}
                          onChange={() => toggle(skill.id)}
                          type="checkbox"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-sm">
                            {skill.name}
                          </span>
                          {skill.description.trim() &&
                          skill.description.trim().toLowerCase() !==
                            skill.name.toLowerCase() ? (
                            <span className="block text-muted-foreground text-xs">
                              {skill.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                      {onProfile ? (
                        <span className="text-muted-foreground text-xs">
                          Added
                        </span>
                      ) : null}
                      {needsBash ? (
                        <Button
                          disabled={busy}
                          onClick={() => void addBash()}
                          size="xs"
                          type="button"
                          variant="outline"
                        >
                          Add bash
                        </Button>
                      ) : null}
                      {!needsBash && needsInstall && user?.isPlatformAdmin ? (
                        <Button
                          disabled={busy}
                          onClick={() => void installBrowser()}
                          size="xs"
                          type="button"
                          variant="outline"
                        >
                          Install
                        </Button>
                      ) : null}
                      {onDelete ? (
                        <Button
                          aria-label={`Delete ${skill.name} from library`}
                          disabled={busy || !canDelete || onProfile}
                          onClick={() => setPendingDelete(skill)}
                          size="icon-sm"
                          title={
                            onProfile
                              ? "Remove this skill from the profile before deleting it"
                              : undefined
                          }
                          type="button"
                          variant="ghost"
                        >
                          <Delete02Icon aria-hidden className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
          </div>
          {installProgress ? (
            <p className="break-all text-muted-foreground text-xs">
              {installProgress}
            </p>
          ) : null}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-3 border-t-0 bg-transparent pt-0">
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !profileId || selected.length === 0}
              onClick={() => void addSelected()}
              type="button"
            >
              {busy && selected.length > 0 ? (
                <Spinner className="size-4" />
              ) : (
                `Add ${selected.length} skill${selected.length === 1 ? "" : "s"}`
              )}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}

function AddSkillDialogContent({
  busy,
  profileId,
  orgId,
  onOpenChange,
  onInstall,
  onAssign,
  onAssignBash,
  onDelete,
  skills,
  assignedSkillIds,
  bashAssigned,
  skillsLoading,
  skillsError,
  running,
  setRunning,
}: AddSkillDialogProps & {
  running: boolean;
  setRunning: (running: boolean) => void;
}) {
  const [tab, setTab] = useState<"organization" | "install">("organization");
  const locked = busy || running;

  return (
    <DialogContent className="gap-5 p-6 sm:max-w-xl" showCloseButton={!locked}>
      <DialogHeader>
        <DialogTitle>Add skill</DialogTitle>
      </DialogHeader>
      <div aria-label="Add skill source" className="flex gap-2" role="tablist">
        <Button
          aria-selected={tab === "organization"}
          disabled={locked}
          onClick={() => setTab("organization")}
          role="tab"
          type="button"
          variant={tab === "organization" ? "default" : "outline"}
        >
          From organization
        </Button>
        <Button
          aria-selected={tab === "install"}
          disabled={locked}
          onClick={() => setTab("install")}
          role="tab"
          type="button"
          variant={tab === "install" ? "default" : "outline"}
        >
          Install new
        </Button>
      </div>
      {tab === "organization" ? (
        <OrganizationSkills
          assignedSkillIds={assignedSkillIds}
          bashAssigned={bashAssigned}
          disabled={locked}
          onAssign={onAssign}
          onAssignBash={onAssignBash}
          onDelete={onDelete}
          onOpenChange={onOpenChange}
          orgId={orgId}
          profileId={profileId}
          setRunning={setRunning}
          skills={skills}
          skillsError={skillsError}
          skillsLoading={skillsLoading}
        />
      ) : (
        <InstallSkillForm
          busy={locked}
          onOpenChange={onOpenChange}
          onSubmit={onInstall}
          profileId={profileId}
          setRunning={setRunning}
        />
      )}
    </DialogContent>
  );
}

function InstallSkillForm({
  busy,
  profileId,
  onOpenChange,
  onSubmit,
  setRunning,
}: {
  busy: boolean;
  profileId: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: InstallSkillRequest) => Promise<void>;
  setRunning: (running: boolean) => void;
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
    setRunning(true);

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
    } finally {
      setRunning(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid grid-cols-3 gap-2" role="tablist">
        {[
          ["github", "GitHub URL"],
          ["command", "npx command"],
          ["upload", "Upload ZIP"],
        ].map(([value, label]) => (
          <Button
            disabled={busy}
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
  );
}
