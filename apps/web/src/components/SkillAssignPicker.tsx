import type { SkillSummary } from "@nakama/core/contract";
import {
  BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
} from "@nakama/core/skills/bundled-names";
import { CheckIcon, DownloadIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import {
  useAgentBrowserSettings,
  useInstallAgentBrowser,
} from "@/hooks/use-agent-browser-settings";
import { useCodingHarnessSettings } from "@/hooks/use-coding-harness-settings";
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
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

const bundledSkillNames = new Set<string>(BUNDLED_SKILL_NAMES);
const runtimeOnlySkillNames = new Set<string>(RUNTIME_ONLY_BUNDLED_SKILL_NAMES);
const AGENT_BROWSER_SKILL_NAME = "agent-browser";

function isUserLibrarySkill(skill: SkillSummary): boolean {
  return !bundledSkillNames.has(skill.name);
}

interface SkillAssignPickerProps {
  skills: SkillSummary[];
  assignedSkillIds?: ReadonlySet<string>;
  disabled?: boolean;
  buttonLabel?: string;
  onAssign: (skillId: string) => void | Promise<void>;
  onDelete?: (skillId: string) => void | Promise<void>;
  bashAssigned?: boolean;
  onAssignBash?: () => void | Promise<void>;
  className?: string;
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
  setOpen: (open: boolean) => void,
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
    <div className="min-w-0 space-y-2 overflow-hidden border-b border-border/60 px-6 py-3 text-xs text-amber-600 dark:text-amber-300">
      {agentBrowserNeedsInstall ? (
        <p className="min-w-0 break-words">
          Install the agent-browser CLI and Chrome on this server before assigning this skill.
        </p>
      ) : null}
      {bashNeedsAssign ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-words">This profile also needs the bash tool.</span>
          {onAssignBash ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled || assigningBash}
              onClick={(event) => void onAssignBashClick(event)}
            >
              {assigningBash ? <Spinner className="size-3.5" /> : <PlusIcon aria-hidden />}
              Add bash
            </Button>
          ) : null}
        </div>
      ) : null}
      {installProgress ? (
        <div className="min-w-0 max-w-full overflow-hidden rounded-md bg-amber-500/5 px-2 py-1.5">
          <p
            className="line-clamp-3 min-w-0 break-all font-mono text-[11px] leading-snug text-amber-700/90 dark:text-amber-200/90"
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

function CodingHarnessPrerequisitesNotice() {
  return (
    <div className="border-b border-border/60 px-6 py-3 text-xs text-amber-600 dark:text-amber-300">
      Install and verify a coding agent in Integrations before assigning this skill.
      <Button
        type="button"
        variant="link"
        size="sm"
        className="ml-1 h-auto px-0 py-0 text-amber-700 dark:text-amber-200"
        render={<Link to="/integrations?section=coding-agents" />}
      >
        Open Integrations
      </Button>
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
      <Button type="button" variant="outline" disabled={deleting} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" variant="destructive" disabled={deleting} onClick={onConfirm}>
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
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || assigningBash}
          className="[&_svg]:pointer-events-auto"
          onPointerDown={stopCommandItemSelect}
          onClick={(event) => void onAssignBash(event)}
        >
          {assigningBash ? <Spinner className="size-3.5" /> : <PlusIcon aria-hidden />}
          Add bash
        </Button>
      ) : rowAction === "install" ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || installingAgentBrowser}
          className="[&_svg]:pointer-events-auto"
          onPointerDown={stopCommandItemSelect}
          onClick={onInstall}
        >
          {installingAgentBrowser ? <Spinner className="size-3.5" /> : <DownloadIcon aria-hidden />}
          Install
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || skillDisabled}
          className="[&_svg]:pointer-events-auto"
          onPointerDown={stopCommandItemSelect}
          onClick={onAdd}
        >
          <PlusIcon aria-hidden />
          Add
        </Button>
      )}
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground/60 hover:text-destructive [&_svg]:pointer-events-auto"
          disabled={disabled || !canDelete}
          title={canDelete ? undefined : "Bundled system skills cannot be deleted"}
          aria-label={
            canDelete
              ? `Delete ${skill.name} from library`
              : `${skill.name} is a bundled skill and cannot be deleted`
          }
          onPointerDown={stopCommandItemSelect}
          onClick={(event) => onRequestDelete(skill, event)}
        >
          <Trash2Icon className="size-4" aria-hidden />
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
      value={`${skill.name} ${skill.description}`}
      disabled={commandItemDisabled}
      className={cn(
        "items-center gap-3 px-3 py-2.5",
        agentBrowserDisabled && "cursor-default",
        onDelete && "[&>svg:last-child]:hidden",
      )}
      onSelect={onSelect}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate text-sm font-medium leading-tight">{skill.name}</p>
        {description ? (
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{description}</p>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">Not on this profile yet</p>
        )}
        {meta ? (
          <p className="text-xs leading-snug text-muted-foreground/80">{meta}</p>
        ) : null}
        {skillDisabled ? (
          <p className="text-xs text-amber-600 dark:text-amber-300">
            {skill.name === AGENT_BROWSER_SKILL_NAME
              ? !bashAssigned
                ? "Add the bash tool to this profile first."
                : "Install agent-browser on this server first."
              : "Set up a coding agent first."}
          </p>
        ) : null}
      </div>
      <AvailableSkillActions
        skill={skill}
        rowAction={rowAction}
        disabled={disabled}
        assigningBash={assigningBash}
        installingAgentBrowser={installingAgentBrowser}
        skillDisabled={skillDisabled}
        canDelete={canDelete}
        onDelete={onDelete}
        onAssignBash={onAssignBash}
        onInstall={onInstall}
        onAdd={onAdd}
        onRequestDelete={onRequestDelete}
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
      value={`${skill.name} ${skill.description}`}
      className={cn(
        "cursor-default items-center gap-3 bg-muted/20 px-3 py-2.5 data-selected:bg-muted/20",
        onDelete && "[&>svg:last-child]:hidden",
      )}
      onSelect={() => {}}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium leading-tight text-muted-foreground">
            {skill.name}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CheckIcon className="size-3" aria-hidden />
            On profile
          </span>
        </div>
        {description ? (
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{description}</p>
        ) : null}
        {meta ? (
          <p className="text-xs leading-snug text-muted-foreground/80">{meta}</p>
        ) : null}
      </div>
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 self-center text-muted-foreground/60 [&_svg]:pointer-events-auto"
          disabled
          title="Remove this skill from the profile before deleting it from the library"
          aria-label={`${skill.name} is on this profile and cannot be deleted from the library`}
          onPointerDown={stopCommandItemSelect}
        >
          <Trash2Icon className="size-4" aria-hidden />
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [assigningBash, setAssigningBash] = useState(false);
  const [agentBrowserInstallProgress, setAgentBrowserInstallProgress] = useState<string | null>(null);
  const [agentBrowserInstallError, setAgentBrowserInstallError] = useState<string | null>(null);

  const librarySkills = skills.filter((skill) => !runtimeOnlySkillNames.has(skill.name));
  const hasAgentBrowserSkill = librarySkills.some((skill) => skill.name === AGENT_BROWSER_SKILL_NAME);
  const { data: codingHarnessSettings } = useCodingHarnessSettings(open);
  const { data: agentBrowserSettings } = useAgentBrowserSettings(open && hasAgentBrowserSkill);
  const installAgentBrowserMutation = useInstallAgentBrowser();

  const availableSkills = librarySkills.filter((skill) => !assignedSkillIds.has(skill.id));
  const onProfileSkills = librarySkills.filter((skill) => assignedSkillIds.has(skill.id));
  const canDeleteLibrarySkills = Boolean(onDelete);
  const agentBrowserNeedsInstall = hasAgentBrowserSkill && agentBrowserSettings?.ready === false;
  const bashNeedsAssign = hasAgentBrowserSkill && !bashAssigned;
  const showAgentBrowserPrereqs = hasAgentBrowserSkill && (agentBrowserNeedsInstall || bashNeedsAssign);
  const installingAgentBrowser = installAgentBrowserMutation.isPending;

  function isAgentBrowserDisabled(skill: SkillSummary): boolean {
    return (
      skill.name === AGENT_BROWSER_SKILL_NAME &&
      (agentBrowserSettings?.ready === false || !bashAssigned)
    );
  }

  function isCommandItemDisabled(skill: SkillSummary): boolean {
    if (disabled) {
      return true;
    }

    if (skill.name === "coding-agent" && codingHarnessSettings?.configured === false) {
      return true;
    }

    // Keep agent-browser rows interactive so Install / Add bash buttons stay clickable.
    return false;
  }

  function isSkillDisabled(skill: SkillSummary): boolean {
    return (
      (skill.name === "coding-agent" && codingHarnessSettings?.configured === false) ||
      isAgentBrowserDisabled(skill)
    );
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
    if (!onDelete || !pendingDelete || deleting) {
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
        onSuccess: (status) => {
          setAgentBrowserInstallProgress(null);
          if (!status.ready) {
            setAgentBrowserInstallError(
              status.statusMessage ??
                "Install finished, but agent-browser is not ready yet. Try again or install manually.",
            );
          }
        },
        onError: (error) => {
          setAgentBrowserInstallProgress(null);
          setAgentBrowserInstallError(formatError(error));
        },
      },
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
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={className}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setPendingDelete(null);
            setDeleting(false);
            setAgentBrowserInstallProgress(null);
            setAgentBrowserInstallError(null);
          }
        }}
      >
        <DialogContent className="min-w-0 gap-0 overflow-x-hidden p-0 sm:max-w-xl">
          <DialogHeader className="gap-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>{pendingDelete ? "Delete skill?" : "Manage skills"}</DialogTitle>
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
                  bashNeedsAssign={bashNeedsAssign}
                  onAssignBash={onAssignBash}
                  disabled={disabled}
                  assigningBash={assigningBash}
                  onAssignBashClick={handleAssignBash}
                  installProgress={agentBrowserInstallProgress}
                  installError={agentBrowserInstallError}
                />
              ) : null}

              {codingHarnessSettings?.configured === false ? (
                <CodingHarnessPrerequisitesNotice />
              ) : null}

              <Command className="min-w-0 rounded-none bg-transparent">
                <div className="min-w-0 border-b border-border/60 px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
                  <CommandInput placeholder="Search skills…" />
                </div>
                <CommandList className="max-h-72 min-w-0 p-2">
                  <CommandEmpty>No skills found.</CommandEmpty>

                  {availableSkills.length > 0 ? (
                    <CommandGroup heading="Add to profile" className="space-y-1">
                      {availableSkills.map((skill) => (
                        <AvailableSkillCommandItem
                          key={skill.id}
                          skill={skill}
                          disabled={disabled}
                          agentBrowserDisabled={isAgentBrowserDisabled(skill)}
                          commandItemDisabled={isCommandItemDisabled(skill)}
                          skillDisabled={isSkillDisabled(skill)}
                          rowAction={agentBrowserRowAction(skill)}
                          assigningBash={assigningBash}
                          installingAgentBrowser={installingAgentBrowser}
                          canDelete={canDeleteSkill(skill)}
                          onDelete={onDelete}
                          bashAssigned={bashAssigned}
                          onSelect={() => {
                            if (isSkillDisabled(skill)) {
                              return;
                            }
                            assignSkill(skill.id, onAssign, setOpen);
                          }}
                          onAssignBash={handleAssignBash}
                          onInstall={handleInstallAgentBrowser}
                          onAdd={(event) => {
                            stopCommandItemSelect(event);
                            if (isSkillDisabled(skill)) {
                              return;
                            }
                            assignSkill(skill.id, onAssign, setOpen);
                          }}
                          onRequestDelete={requestDelete}
                        />
                      ))}
                    </CommandGroup>
                  ) : null}

                  {availableSkills.length > 0 && onProfileSkills.length > 0 ? (
                    <CommandSeparator className="my-2" />
                  ) : null}

                  {onProfileSkills.length > 0 ? (
                    <CommandGroup heading="Already on this profile" className="space-y-1">
                      {onProfileSkills.map((skill) => (
                        <OnProfileSkillCommandItem
                          key={skill.id}
                          skill={skill}
                          onDelete={onDelete}
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
