import type {
  AgentBrowserStatusResponse,
  InstallSkillRequest,
  SkillSummary,
} from "@nakama/core/contract";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Spinner } from "@nakama/ui/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Delete02Icon } from "hugeicons-react";
import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useAuth } from "@/context/use-auth";
import {
  useAgentBrowserSettings,
  useInstallAgentBrowser,
} from "@/hooks/use-agent-browser-settings";
import { isPluginOwned } from "@/hooks/use-plugins";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const bundledNames = new Set<string>(BUNDLED_SKILL_NAMES);
const runtimeOnlyNames = new Set<string>(RUNTIME_ONLY_BUNDLED_SKILL_NAMES);

function needsBrowserInstall(
  mode: "managed" | "local_cdp",
  status?: AgentBrowserStatusResponse
): boolean {
  if (mode === "managed") {
    return status?.ready !== true;
  }
  const version = status?.version?.match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  return !(version && (Number(version[1]) > 0 || Number(version[2]) >= 34));
}

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

function BrowserConnectionSettings({
  busy,
  mode,
  onModeChange,
  port,
  profileId,
  setRunning,
}: {
  busy: boolean;
  mode: "managed" | "local_cdp";
  onModeChange: (mode: "managed" | "local_cdp" | null) => void;
  port: number | null;
  profileId: string;
  setRunning: (running: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [portOverride, setPortOverride] = useState<string | null>(null);
  const [choiceOverride, setChoiceOverride] = useState<
    "managed" | "browseros_neo" | "local_cdp" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const choice = choiceOverride ?? mode;
  const portValue =
    portOverride ?? (choice === "browseros_neo" ? "" : String(port ?? ""));
  const cdpPort = Number(portValue);
  const validPort =
    Number.isInteger(cdpPort) && cdpPort >= 1 && cdpPort <= 65_535;

  async function selectConnection(value: string | null) {
    if (value == null) {
      return;
    }
    const nextChoice = value as typeof choice;
    setChoiceOverride(nextChoice);
    onModeChange(nextChoice === "managed" ? "managed" : "local_cdp");
    setPortOverride(nextChoice === "browseros_neo" ? "" : null);
    setMessage(null);
    if (nextChoice === "browseros_neo") {
      setRunning(true);
      try {
        const { port: neoPort } = await client.getBrowserOsNeoCdpPort();
        setPortOverride(String(neoPort));
      } catch (cause) {
        setMessage(formatError(cause));
      } finally {
        setRunning(false);
      }
    }
  }

  async function run(action: "save" | "test") {
    if (mode === "local_cdp" && !validPort) {
      return;
    }
    setRunning(true);
    setMessage(null);
    try {
      if (action === "test") {
        const result = await client.testAgentBrowserCdp(cdpPort);
        setMessage(result.message);
      } else {
        await client.updateProfile(profileId, {
          agentBrowserCdpPort: mode === "local_cdp" ? cdpPort : null,
          agentBrowserMode: mode,
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(profileId),
        });
        onModeChange(null);
        setChoiceOverride(null);
        setPortOverride(null);
        setMessage("Connection saved.");
      }
    } catch (cause) {
      setMessage(formatError(cause));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="block text-sm" htmlFor="agent-browser-mode">
        Browser connection
      </label>
      <Select
        disabled={busy}
        onValueChange={(value) => void selectConnection(value)}
        value={choice}
      >
        <SelectTrigger className="w-full" id="agent-browser-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="managed">Managed Chrome</SelectItem>
          <SelectItem value="browseros_neo">BrowserOS Neo</SelectItem>
          <SelectItem value="local_cdp">Local CDP</SelectItem>
        </SelectContent>
      </Select>
      {choice === "local_cdp" ? (
        <>
          <label className="block text-sm" htmlFor="agent-browser-port">
            CDP port
          </label>
          <Input
            disabled={busy}
            id="agent-browser-port"
            max={65_535}
            min={1}
            onChange={(event) => {
              setPortOverride(event.target.value);
              setMessage(null);
            }}
            type="number"
            value={portValue}
          />
        </>
      ) : null}
      {mode === "local_cdp" ? (
        <>
          <p className="text-muted-foreground text-xs">
            Local CDP controls the browser directly. Remove BrowserOS Neo MCP
            from this profile to remove its tool definitions.
          </p>
          <Button
            disabled={busy || !validPort}
            onClick={() => void run("test")}
            size="sm"
            type="button"
            variant="outline"
          >
            Test connection
          </Button>
        </>
      ) : null}
      <Button
        disabled={busy || (mode === "local_cdp" && !validPort)}
        onClick={() => void run("save")}
        size="sm"
        type="button"
      >
        Save connection
      </Button>
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function BrowserConnectionControl({
  isPlatformAdmin,
  profileId,
  skillAvailable,
  ...settings
}: {
  busy: boolean;
  isPlatformAdmin: boolean;
  mode: "managed" | "local_cdp";
  onModeChange: (mode: "managed" | "local_cdp" | null) => void;
  port: number | null;
  profileId: string | null;
  setRunning: (running: boolean) => void;
  skillAvailable: boolean;
}) {
  if (!(isPlatformAdmin && profileId && skillAvailable)) {
    return null;
  }
  return <BrowserConnectionSettings {...settings} profileId={profileId} />;
}

function SkillPickerMessages({
  error,
  progress,
}: {
  error: string | null;
  progress: string | null;
}) {
  return (
    <>
      {progress ? (
        <p className="break-all text-muted-foreground text-xs">{progress}</p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function useBrowserInstaller({
  bashAssigned,
  canInstall,
  mode,
  setError,
  setInstallProgress,
  setRunning,
}: {
  bashAssigned: boolean;
  canInstall: boolean;
  mode: "managed" | "local_cdp";
  setError: (message: string | null) => void;
  setInstallProgress: (message: string | null) => void;
  setRunning: (running: boolean) => void;
}) {
  const browserInstall = useInstallAgentBrowser();

  async function installBrowser() {
    if (!(bashAssigned && canInstall) || browserInstall.isPending) {
      return;
    }
    setRunning(true);
    setError(null);
    setInstallProgress(null);
    try {
      const status = await browserInstall.mutateAsync({
        cliOnly: mode === "local_cdp",
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

  return { installBrowser, installing: browserInstall.isPending };
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
  const { data: profile } = useQuery({
    enabled: Boolean(profileId && user?.isPlatformAdmin),
    queryFn: async () => (await client.getProfile(profileId!)).profile,
    queryKey: profileId
      ? queryKeys.profiles.detail(profileId)
      : ["profile", "none"],
  });
  const [modeOverride, setModeOverride] = useState<
    "managed" | "local_cdp" | null
  >(null);
  const browserMode = modeOverride ?? profile?.agentBrowserMode ?? "managed";
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillSummary | null>(null);
  const [installProgress, setInstallProgress] = useState<string | null>(null);
  const hasBrowserSkill = skills.some(
    (skill) => skill.name === "agent-browser"
  );
  const { data: browserStatus } = useAgentBrowserSettings(hasBrowserSkill);
  const { installBrowser, installing } = useBrowserInstaller({
    bashAssigned,
    canInstall: user?.isPlatformAdmin === true,
    mode: browserMode,
    setError,
    setInstallProgress,
    setRunning,
  });
  const busy = disabled || installing;
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
  const browserNeedsInstall = needsBrowserInstall(browserMode, browserStatus);

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
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- Stop on failure and keep later skills selected.
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

  if (pendingDelete) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>Delete skill?</DialogTitle>
          <DialogDescription>
            Delete "{pendingDelete.name}" from the library? This removes it from
            every profile.
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
    );
  }

  return (
    <div className="space-y-4">
      <BrowserConnectionControl
        busy={busy}
        isPlatformAdmin={user?.isPlatformAdmin === true}
        mode={browserMode}
        onModeChange={setModeOverride}
        port={profile?.agentBrowserCdpPort ?? null}
        profileId={profileId}
        setRunning={setRunning}
        skillAvailable={hasBrowserSkill}
      />
      <Input
        aria-label="Search skills"
        disabled={busy}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search skills..."
        value={search}
      />
      <OrganizationSkillList
        bashAssigned={bashAssigned}
        browserNeedsInstall={browserNeedsInstall}
        busy={busy}
        canInstallBrowser={user?.isPlatformAdmin === true}
        isAdded={isAdded}
        onAddBash={addBash}
        onDelete={onDelete}
        onInstallBrowser={installBrowser}
        onRequestDelete={setPendingDelete}
        onToggle={toggle}
        results={results}
        selectedSkillIds={new Set(selected)}
        skillsError={skillsError}
        skillsLoading={skillsLoading}
        visibleSkillCount={visibleSkills.length}
      />
      <SkillPickerMessages error={error} progress={installProgress} />
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
    </div>
  );
}

function OrganizationSkillList({
  bashAssigned,
  browserNeedsInstall,
  busy,
  canInstallBrowser,
  isAdded,
  onAddBash,
  onDelete,
  onInstallBrowser,
  onRequestDelete,
  onToggle,
  results,
  selectedSkillIds,
  skillsError,
  skillsLoading,
  visibleSkillCount,
}: {
  bashAssigned: boolean;
  browserNeedsInstall: boolean;
  busy: boolean;
  canInstallBrowser: boolean;
  isAdded: (skillId: string) => boolean;
  onAddBash: () => Promise<void>;
  onDelete?: (skillId: string) => Promise<void>;
  onInstallBrowser: () => Promise<void>;
  onRequestDelete: (skill: SkillSummary) => void;
  onToggle: (skillId: string) => void;
  results: SkillSummary[];
  selectedSkillIds: ReadonlySet<string>;
  skillsError: unknown;
  skillsLoading: boolean;
  visibleSkillCount: number;
}) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border border-border">
      {skillsLoading ? (
        <p className="p-4 text-muted-foreground text-sm">Loading skills...</p>
      ) : null}
      {!skillsLoading && skillsError ? (
        <p className="p-4 text-destructive text-sm" role="alert">
          Could not load skills. Try again.
        </p>
      ) : null}
      {!(skillsLoading || skillsError) && visibleSkillCount === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">
          No organization skills yet. Use Install new.
        </p>
      ) : null}
      {!(skillsLoading || skillsError) &&
      visibleSkillCount > 0 &&
      results.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">No skills found.</p>
      ) : null}
      {skillsLoading || skillsError
        ? null
        : results.map((skill) => (
            <OrganizationSkillRow
              bashAssigned={bashAssigned}
              browserNeedsInstall={browserNeedsInstall}
              busy={busy}
              canInstallBrowser={canInstallBrowser}
              isAdded={isAdded(skill.id)}
              key={skill.id}
              onAddBash={onAddBash}
              onDelete={onDelete}
              onInstallBrowser={onInstallBrowser}
              onRequestDelete={onRequestDelete}
              onToggle={onToggle}
              selected={selectedSkillIds.has(skill.id)}
              skill={skill}
            />
          ))}
    </div>
  );
}

function OrganizationSkillRow({
  bashAssigned,
  browserNeedsInstall,
  busy,
  canInstallBrowser,
  isAdded,
  onAddBash,
  onDelete,
  onInstallBrowser,
  onRequestDelete,
  onToggle,
  selected,
  skill,
}: {
  bashAssigned: boolean;
  browserNeedsInstall: boolean;
  busy: boolean;
  canInstallBrowser: boolean;
  isAdded: boolean;
  onAddBash: () => Promise<void>;
  onDelete?: (skillId: string) => Promise<void>;
  onInstallBrowser: () => Promise<void>;
  onRequestDelete: (skill: SkillSummary) => void;
  onToggle: (skillId: string) => void;
  selected: boolean;
  skill: SkillSummary;
}) {
  const isBrowser = skill.name === "agent-browser";
  const needsBash = isBrowser && !bashAssigned;
  const needsInstall = isBrowser && browserNeedsInstall;
  const description = skill.description.trim();

  return (
    <div className="flex items-center gap-3 border-border border-b px-3 py-3 last:border-b-0">
      <label className="flex min-w-0 flex-1 items-start gap-3">
        <input
          aria-label={`Add ${skill.name}`}
          checked={selected || isAdded}
          className="mt-1"
          disabled={busy || isAdded || needsBash || needsInstall}
          onChange={() => onToggle(skill.id)}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="block font-medium text-sm">{skill.name}</span>
          {description &&
          description.toLowerCase() !== skill.name.toLowerCase() ? (
            <span className="block text-muted-foreground text-xs">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {isAdded ? (
        <span className="text-muted-foreground text-xs">Added</span>
      ) : null}
      <OrganizationSkillActions
        busy={busy}
        canInstallBrowser={canInstallBrowser}
        isAdded={isAdded}
        needsBash={needsBash}
        needsInstall={needsInstall}
        onAddBash={onAddBash}
        onDelete={onDelete}
        onInstallBrowser={onInstallBrowser}
        onRequestDelete={onRequestDelete}
        skill={skill}
      />
    </div>
  );
}

function OrganizationSkillActions({
  busy,
  canInstallBrowser,
  isAdded,
  needsBash,
  needsInstall,
  onAddBash,
  onDelete,
  onInstallBrowser,
  onRequestDelete,
  skill,
}: {
  busy: boolean;
  canInstallBrowser: boolean;
  isAdded: boolean;
  needsBash: boolean;
  needsInstall: boolean;
  onAddBash: () => Promise<void>;
  onDelete?: (skillId: string) => Promise<void>;
  onInstallBrowser: () => Promise<void>;
  onRequestDelete: (skill: SkillSummary) => void;
  skill: SkillSummary;
}) {
  const canDelete = Boolean(
    onDelete &&
      canInstallBrowser &&
      !bundledNames.has(skill.name) &&
      !isPluginOwned(skill)
  );

  return (
    <>
      {needsBash ? (
        <Button
          disabled={busy}
          onClick={() => void onAddBash()}
          size="xs"
          type="button"
          variant="outline"
        >
          Add bash
        </Button>
      ) : null}
      {!needsBash && needsInstall && canInstallBrowser ? (
        <Button
          disabled={busy}
          onClick={() => void onInstallBrowser()}
          size="xs"
          type="button"
          variant="outline"
        >
          Install or upgrade
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          aria-label={`Delete ${skill.name} from library`}
          disabled={busy || !canDelete || isAdded}
          onClick={() => onRequestDelete(skill)}
          size="icon-sm"
          title={
            isAdded
              ? "Remove this skill from the profile before deleting it"
              : undefined
          }
          type="button"
          variant="ghost"
        >
          <Delete02Icon aria-hidden className="size-4" />
        </Button>
      ) : null}
    </>
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
