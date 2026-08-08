import type { SkillSummary } from "@nakama/core/contract";
import {
  BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
} from "@nakama/core/skills/bundled-names";
import { CheckIcon, DownloadIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  useAgentBrowserSettings,
  useInstallAgentBrowser,
} from "@/hooks/use-agent-browser-settings";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);
const runtimeOnlySkillNames = new Set<string>(RUNTIME_ONLY_BUNDLED_SKILL_NAMES);
const AGENT_BROWSER_SKILL_NAME = "agent-browser";

function isUserLibrarySkill(skill: SkillSummary): boolean {
  return !bundledSkillNames.has(skill.name);
}

interface SkillAssignPickerProps {
  assignedSkillIds?: ReadonlySet<string>;
  bashAssigned?: boolean;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  onAssign: (skillId: string) => void | Promise<void>;
  onAssignBash?: () => void | Promise<void>;
  onDelete?: (skillId: string) => void | Promise<void>;
  skills: SkillSummary[];
}

function formatSkillMeta(skill: SkillSummary): string {
  const parts: string[] = [];

  if (skill.hasTool) {
    parts.push("includes tool");
  }

  if (skill.disableModelInvocation) {
    parts.push("explicit invoke only");
  }

  return parts.join(" · ");
}

function skillDescription(skill: SkillSummary): string | null {
  const trimmed = skill.description.trim();
  if (!trimmed || trimmed.toLowerCase() === skill.name.trim().toLowerCase()) {
    return null;
  }

  return trimmed;
}

function assignSkill(
  skillId: string,
  onAssign: (skillId: string) => void | Promise<void>,
  setOpen: (open: boolean) => void
) {
  void onAssign(skillId);
  setOpen(false);
}

function stopCommandItemSelect(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

type AgentBrowserRowAction = "add-bash" | "install" | "add";

function AgentBrowserPrerequisitesNotice({
  agentBrowserNeedsInstall,
  bashNeedsAssign,
  onAssignBash,
  disabled,
  assigningBash,
  onAssignBashClick,
  installProgress,
  installError,
}: {
  agentBrowserNeedsInstall: boolean;
  bashNeedsAssign: boolean;
  onAssignBash?: () => void | Promise<void>;
  disabled: boolean;
  assigningBash: boolean;
  onAssignBashClick: (event: SyntheticEvent) => void;
  installProgress: string | null;
  installError: string | null;
}) {
  return (
    <div className="min-w-0 space-y-2 overflow-hidden border-border/60 border-b px-6 py-3 text-amber-600 text-xs dark:text-amber-300">
      {agentBrowserNeedsInstall ? (
        <p className="min-w-0 break-words">
          Install the agent-browser CLI and Chrome on this server before
          assigning this skill.
        </p>
      ) : null}
      {bashNeedsAssign ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-words">
            This profile also needs the bash tool.
          </span>
          {onAssignBash ? (
            <Button
              disabled={disabled || assigningBash}
              onClick={(event) => void onAssignBashClick(event)}
              size="xs"
              type="button"
              variant="outline"
            >
              {assigningBash ? (
                <Spinner className="size-3.5" />
              ) : (
                <PlusIcon aria-hidden />
              )}
              Add bash
            </Button>
          ) : null}
        </div>
      ) : null}
      {installProgress ? (
        <div className="min-w-0 max-w-full overflow-hidden rounded-md bg-amber-500/5 px-2 py-1.5">
          <p
            className="line-clamp-3 min-w-0 break-all font-mono text-[11px] text-amber-700/90 leading-snug dark:text-amber-200/90"
            title={installProgress}
          >
            {installProgress}
          </p>
        </div>
      ) : null}
      {installError ? (
        <p className="min-w-0 break-words text-destructive">{installError}</p>
      ) : null}
    </div>
  );
}

function SkillDeleteConfirmActions({
  deleting,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 px-6 py-4">
      <Button
        disabled={deleting}
        onClick={onCancel}
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
      <Button
        disabled={deleting}
        onClick={onConfirm}
        type="button"
        variant="destructive"
      >
        {deleting ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
}

function AvailableSkillActions({
  skill,
  rowAction,
  disabled,
  assigningBash,
  installingAgentBrowser,
  skillDisabled,
  canDelete,
  onDelete,
  onAssignBash,
  onInstall,
  onAdd,
  onRequestDelete,
}: {
  skill: SkillSummary;
  rowAction: AgentBrowserRowAction;
  disabled: boolean;
  assigningBash: boolean;
  installingAgentBrowser: boolean;
  skillDisabled: boolean;
  canDelete: boolean;
  onDelete?: (skillId: string) => void | Promise<void>;
  onAssignBash: (event: SyntheticEvent) => void;
  onInstall: (event: SyntheticEvent) => void;
  onAdd: (event: SyntheticEvent) => void;
  onRequestDelete: (skill: SkillSummary, event: SyntheticEvent) => void;
}) {
  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-1">
      {rowAction === "add-bash" ? (
        <Button
          className="[&_svg]:pointer-events-auto"
          disabled={disabled || assigningBash}
          onClick={(event) => void onAssignBash(event)}
          onPointerDown={stopCommandItemSelect}
          size="xs"
          type="button"
          variant="outline"
        >
          {assigningBash ? (
            <Spinner className="size-3.5" />
          ) : (
            <PlusIcon aria-hidden />
          )}
          Add bash
        </Button>
      ) : rowAction === "install" ? (
        <Button
          className="[&_svg]:pointer-events-auto"
          disabled={disabled || installingAgentBrowser}
          onClick={onInstall}
          onPointerDown={stopCommandItemSelect}
          size="xs"
          type="button"
          variant="outline"
        >
          {installingAgentBrowser ? (
            <Spinner className="size-3.5" />
          ) : (
            <DownloadIcon aria-hidden />
          )}
          Install
        </Button>
      ) : (
        <Button
          className="[&_svg]:pointer-events-auto"
          disabled={disabled || skillDisabled}
          onClick={onAdd}
          onPointerDown={stopCommandItemSelect}
          size="xs"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden />
          Add
        </Button>
      )}
      {onDelete ? (
        <Button
          aria-label={
            canDelete
              ? `Delete ${skill.name} from library`
              : `${skill.name} is a bundled skill and cannot be deleted`
          }
          className="text-muted-foreground/60 hover:text-destructive [&_svg]:pointer-events-auto"
          disabled={disabled || !canDelete}
          onClick={(event) => onRequestDelete(skill, event)}
          onPointerDown={stopCommandItemSelect}
          size="icon-sm"
          title={
            canDelete ? undefined : "Bundled system skills cannot be deleted"
          }
          type="button"
          variant="ghost"
        >
          <Trash2Icon aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function AvailableSkillCommandItem({
  skill,
  disabled,
  agentBrowserDisabled,
  commandItemDisabled,
  skillDisabled,
  rowAction,
  assigningBash,
  installingAgentBrowser,
  canDelete,
  onDelete,
  bashAssigned,
  onSelect,
  onAssignBash,
  onInstall,
  onAdd,
  onRequestDelete,
}: {
  skill: SkillSummary;
  disabled: boolean;
  agentBrowserDisabled: boolean;
  commandItemDisabled: boolean;
  skillDisabled: boolean;
  rowAction: AgentBrowserRowAction;
  assigningBash: boolean;
  installingAgentBrowser: boolean;
  canDelete: boolean;
  onDelete?: (skillId: string) => void | Promise<void>;
  bashAssigned: boolean;
  onSelect: () => void;
  onAssignBash: (event: SyntheticEvent) => void;
  onInstall: (event: SyntheticEvent) => void;
  onAdd: (event: SyntheticEvent) => void;
  onRequestDelete: (skill: SkillSummary, event: SyntheticEvent) => void;
}) {
  const meta = formatSkillMeta(skill);
  const description = skillDescription(skill);

  return (
    <CommandItem
      className={cn(
        "items-center gap-3 px-3 py-2.5",
        agentBrowserDisabled && "cursor-default",
        onDelete && "[&>svg:last-child]:hidden"
      )}
      disabled={commandItemDisabled}
      onSelect={onSelect}
      value={`${skill.name} ${skill.description}`}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate font-medium text-sm leading-tight">
          {skill.name}
        </p>
        {description ? (
          <p className="line-clamp-2 text-muted-foreground text-xs leading-snug">
            {description}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs leading-snug">
            Not on this profile yet
          </p>
        )}
        {meta ? (
          <p className="text-muted-foreground/80 text-xs leading-snug">
            {meta}
          </p>
        ) : null}
        {skillDisabled ? (
          <p className="text-amber-600 text-xs dark:text-amber-300">
            {skill.name === AGENT_BROWSER_SKILL_NAME
              ? bashAssigned
                ? "Install agent-browser on this server first."
                : "Add the bash tool to this profile first."
              : "Set up a coding agent first."}
          </p>
        ) : null}
      </div>
      <AvailableSkillActions
        assigningBash={assigningBash}
        canDelete={canDelete}
        disabled={disabled}
        installingAgentBrowser={installingAgentBrowser}
        onAdd={onAdd}
        onAssignBash={onAssignBash}
        onDelete={onDelete}
        onInstall={onInstall}
        onRequestDelete={onRequestDelete}
        rowAction={rowAction}
        skill={skill}
        skillDisabled={skillDisabled}
      />
    </CommandItem>
  );
}

function OnProfileSkillCommandItem({
  skill,
  onDelete,
}: {
  skill: SkillSummary;
  onDelete?: (skillId: string) => void | Promise<void>;
}) {
  const meta = formatSkillMeta(skill);
  const description = skillDescription(skill);

  return (
    <CommandItem
      className={cn(
        "cursor-default items-center gap-3 bg-muted/20 px-3 py-2.5 data-selected:bg-muted/20",
        onDelete && "[&>svg:last-child]:hidden"
      )}
      onSelect={() => {}}
      value={`${skill.name} ${skill.description}`}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-muted-foreground text-sm leading-tight">
            {skill.name}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
            <CheckIcon aria-hidden className="size-3" />
            On profile
          </span>
        </div>
        {description ? (
          <p className="line-clamp-2 text-muted-foreground text-xs leading-snug">
            {description}
          </p>
        ) : null}
        {meta ? (
          <p className="text-muted-foreground/80 text-xs leading-snug">
            {meta}
          </p>
        ) : null}
      </div>
      {onDelete ? (
        <Button
          aria-label={`${skill.name} is on this profile and cannot be deleted from the library`}
          className="shrink-0 self-center text-muted-foreground/60 [&_svg]:pointer-events-auto"
          disabled
          onPointerDown={stopCommandItemSelect}
          size="icon-sm"
          title="Remove this skill from the profile before deleting it from the library"
          type="button"
          variant="ghost"
        >
          <Trash2Icon aria-hidden className="size-4" />
        </Button>
      ) : null}
    </CommandItem>
  );
}

export function SkillAssignPicker({
  skills,
  assignedSkillIds = new Set(),
  disabled = false,
  buttonLabel = "Add skill",
  onAssign,
  onDelete,
  bashAssigned = true,
  onAssignBash,
  className,
}: SkillAssignPickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [assigningBash, setAssigningBash] = useState(false);
  const [agentBrowserInstallProgress, setAgentBrowserInstallProgress] =
    useState<string | null>(null);
  const [agentBrowserInstallError, setAgentBrowserInstallError] = useState<
    string | null
  >(null);

  const librarySkills = skills.filter(
    (skill) => !runtimeOnlySkillNames.has(skill.name)
  );
  const hasAgentBrowserSkill = librarySkills.some(
    (skill) => skill.name === AGENT_BROWSER_SKILL_NAME
  );
  const { data: agentBrowserSettings } = useAgentBrowserSettings(
    open && hasAgentBrowserSkill
  );
  const installAgentBrowserMutation = useInstallAgentBrowser();

  const availableSkills = librarySkills.filter(
    (skill) => !assignedSkillIds.has(skill.id)
  );
  const onProfileSkills = librarySkills.filter((skill) =>
    assignedSkillIds.has(skill.id)
  );
  const canDeleteLibrarySkills = Boolean(onDelete);
  const agentBrowserNeedsInstall =
    hasAgentBrowserSkill && agentBrowserSettings?.ready === false;
  const bashNeedsAssign = hasAgentBrowserSkill && !bashAssigned;
  const showAgentBrowserPrereqs =
    hasAgentBrowserSkill && (agentBrowserNeedsInstall || bashNeedsAssign);
  const installingAgentBrowser = installAgentBrowserMutation.isPending;

  function isAgentBrowserDisabled(skill: SkillSummary): boolean {
    return (
      skill.name === AGENT_BROWSER_SKILL_NAME &&
      (agentBrowserSettings?.ready === false || !bashAssigned)
    );
  }

  function isCommandItemDisabled(): boolean {
    if (disabled) {
      return true;
    }

    // Keep agent-browser rows interactive so Install / Add bash buttons stay clickable.
    return false;
  }

  function isSkillDisabled(skill: SkillSummary): boolean {
    return isAgentBrowserDisabled(skill);
  }

  function agentBrowserRowAction(skill: SkillSummary): AgentBrowserRowAction {
    if (skill.name !== AGENT_BROWSER_SKILL_NAME) {
      return "add";
    }

    if (bashNeedsAssign && onAssignBash) {
      return "add-bash";
    }

    if (agentBrowserNeedsInstall) {
      return "install";
    }

    return "add";
  }

  function canDeleteSkill(skill: SkillSummary): boolean {
    return canDeleteLibrarySkills && isUserLibrarySkill(skill);
  }

  function requestDelete(skill: SkillSummary, event: SyntheticEvent) {
    stopCommandItemSelect(event);
    if (!onDelete || disabled || !canDeleteSkill(skill)) {
      return;
    }
    setPendingDelete({ id: skill.id, name: skill.name });
  }

  async function confirmDelete() {
    if (!(onDelete && pendingDelete) || deleting) {
      return;
    }

    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  function handleInstallAgentBrowser(event: SyntheticEvent) {
    stopCommandItemSelect(event);
    if (disabled || installingAgentBrowser || !bashAssigned) {
      return;
    }

    setAgentBrowserInstallError(null);
    setAgentBrowserInstallProgress(null);

    installAgentBrowserMutation.mutate(
      {
        onProgress: (message) => {
          setAgentBrowserInstallProgress(message);
        },
      },
      {
        onError: (error) => {
          setAgentBrowserInstallProgress(null);
          setAgentBrowserInstallError(formatError(error));
        },
        onSuccess: (status) => {
          setAgentBrowserInstallProgress(null);
          if (!status.ready) {
            setAgentBrowserInstallError(
              status.statusMessage ??
                "Install finished, but agent-browser is not ready yet. Try again or install manually."
            );
          }
        },
      }
    );
  }

  async function handleAssignBash(event: SyntheticEvent) {
    stopCommandItemSelect(event);
    if (!onAssignBash || disabled || bashAssigned || assigningBash) {
      return;
    }

    setAssigningBash(true);
    try {
      await onAssignBash();
    } finally {
      setAssigningBash(false);
    }
  }

  if (librarySkills.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        {buttonLabel}
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setPendingDelete(null);
            setDeleting(false);
            setAgentBrowserInstallProgress(null);
            setAgentBrowserInstallError(null);
          }
        }}
        open={open}
      >
        <DialogContent className="min-w-0 gap-0 overflow-x-hidden p-0 sm:max-w-xl">
          <DialogHeader className="gap-1 border-border border-b px-6 py-4 text-left">
            <DialogTitle>
              {pendingDelete ? "Delete skill?" : "Manage skills"}
            </DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `Delete "${pendingDelete.name}" from your library? This removes it from every profile.`
                : "Add skills to this profile. User-created skills can be deleted from your library."}
            </DialogDescription>
          </DialogHeader>

          {pendingDelete ? (
            <SkillDeleteConfirmActions
              deleting={deleting}
              onCancel={() => setPendingDelete(null)}
              onConfirm={() => void confirmDelete()}
            />
          ) : (
            <>
              {showAgentBrowserPrereqs ? (
                <AgentBrowserPrerequisitesNotice
                  agentBrowserNeedsInstall={agentBrowserNeedsInstall}
                  assigningBash={assigningBash}
                  bashNeedsAssign={bashNeedsAssign}
                  disabled={disabled}
                  installError={agentBrowserInstallError}
                  installProgress={agentBrowserInstallProgress}
                  onAssignBash={onAssignBash}
                  onAssignBashClick={handleAssignBash}
                />
              ) : null}

              <Command className="min-w-0 rounded-none bg-transparent">
                <div className="min-w-0 border-border/60 border-b px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
                  <CommandInput placeholder="Search skills…" />
                </div>
                <CommandList className="max-h-72 min-w-0 p-2">
                  <CommandEmpty>No skills found.</CommandEmpty>

                  {availableSkills.length > 0 ? (
                    <CommandGroup
                      className="space-y-1"
                      heading="Add to profile"
                    >
                      {availableSkills.map((skill) => (
                        <AvailableSkillCommandItem
                          agentBrowserDisabled={isAgentBrowserDisabled(skill)}
                          assigningBash={assigningBash}
                          bashAssigned={bashAssigned}
                          canDelete={canDeleteSkill(skill)}
                          commandItemDisabled={isCommandItemDisabled()}
                          disabled={disabled}
                          installingAgentBrowser={installingAgentBrowser}
                          key={skill.id}
                          onAdd={(event) => {
                            stopCommandItemSelect(event);
                            if (isSkillDisabled(skill)) {
                              return;
                            }
                            assignSkill(skill.id, onAssign, setOpen);
                          }}
                          onAssignBash={handleAssignBash}
                          onDelete={onDelete}
                          onInstall={handleInstallAgentBrowser}
                          onRequestDelete={requestDelete}
                          onSelect={() => {
                            if (isSkillDisabled(skill)) {
                              return;
                            }
                            assignSkill(skill.id, onAssign, setOpen);
                          }}
                          rowAction={agentBrowserRowAction(skill)}
                          skill={skill}
                          skillDisabled={isSkillDisabled(skill)}
                        />
                      ))}
                    </CommandGroup>
                  ) : null}

                  {availableSkills.length > 0 && onProfileSkills.length > 0 ? (
                    <CommandSeparator className="my-2" />
                  ) : null}

                  {onProfileSkills.length > 0 ? (
                    <CommandGroup
                      className="space-y-1"
                      heading="Already on this profile"
                    >
                      {onProfileSkills.map((skill) => (
                        <OnProfileSkillCommandItem
                          key={skill.id}
                          onDelete={onDelete}
                          skill={skill}
                        />
                      ))}
                    </CommandGroup>
                  ) : null}
                </CommandList>
              </Command>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
