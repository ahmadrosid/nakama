import type { AcpAgentPresetSummary, ToolSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { cn } from "@nakama/ui/utils";
import type { ChangeEvent, RefObject } from "react";

/** Select items cannot be empty strings, so the built-in chat uses a sentinel. */
export const BUILT_IN_AGENT = "builtin";

export function ProfileCreateDialogForm({
  busy,
  submitError,
  name,
  profileId,
  profileIdHasValue,
  profileIdValid,
  profileIdHelpText,
  avatarPreview,
  avatarInputRef,
  agentId,
  agentPresets,
  tools,
  selectedToolIds,
  onNameChange,
  onProfileIdChange,
  onAgentChange,
  onAvatarSelected,
  onClearAvatar,
  onToolToggle,
  onToolsChange,
}: {
  busy: boolean;
  submitError: string | null;
  name: string;
  profileId: string;
  profileIdHasValue: boolean;
  profileIdValid: boolean;
  profileIdHelpText: string;
  avatarPreview: string | null;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  agentId: string;
  agentPresets: AcpAgentPresetSummary[];
  tools: ToolSummary[];
  selectedToolIds: Set<string>;
  onNameChange: (value: string) => void;
  onProfileIdChange: (value: string) => void;
  onAgentChange: (agentId: string) => void;
  onAvatarSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAvatar: () => void;
  onToolToggle: (toolId: string, checked: boolean) => void;
  onToolsChange: (toolIds: string[]) => void;
}) {
  const agentLabel =
    agentPresets.find((preset) => preset.id === agentId)?.label ?? "Nakama";

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {submitError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {submitError}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="font-medium text-sm" htmlFor="create-profile-name">
            Name
          </label>
          <Input
            autoFocus
            disabled={busy}
            id="create-profile-name"
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Research assistant"
            value={name}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="font-medium text-sm" htmlFor="create-profile-id">
            Agent id
          </label>
          <Input
            aria-describedby="create-profile-id-help"
            aria-invalid={profileIdHasValue && !profileIdValid}
            className="font-mono text-sm"
            disabled={busy}
            id="create-profile-id"
            onChange={(event) => onProfileIdChange(event.target.value)}
            placeholder="research-assistant"
            value={profileId}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="font-medium text-sm" htmlFor="create-profile-agent">
            Agent
          </label>
          <Select
            disabled={busy}
            onValueChange={(next) => onAgentChange(next ?? BUILT_IN_AGENT)}
            value={agentId}
          >
            <SelectTrigger className="w-full" id="create-profile-agent">
              <SelectValue>{agentLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BUILT_IN_AGENT}>Nakama</SelectItem>
              {agentPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p
          className={cn(
            "text-xs sm:col-span-3",
            profileIdHasValue && !profileIdValid
              ? "text-destructive"
              : "text-muted-foreground"
          )}
          id="create-profile-id-help"
        >
          {profileIdHelpText}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {avatarPreview ? (
          <img
            alt="Avatar preview"
            className="size-10 shrink-0 rounded-md border border-border object-cover"
            src={avatarPreview}
          />
        ) : null}
        <input
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          disabled={busy}
          onChange={onAvatarSelected}
          ref={avatarInputRef}
          type="file"
        />
        <Button
          disabled={busy}
          onClick={() => avatarInputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          {avatarPreview ? "Change avatar" : "Choose avatar"}
        </Button>
        {avatarPreview ? (
          <Button
            disabled={busy}
            onClick={onClearAvatar}
            size="sm"
            type="button"
            variant="ghost"
          >
            Remove
          </Button>
        ) : null}
      </div>

      <ToolChecklist
        busy={busy}
        onToolsChange={onToolsChange}
        onToolToggle={onToolToggle}
        overMcp={agentId !== BUILT_IN_AGENT}
        selectedToolIds={selectedToolIds}
        tools={tools}
      />
    </div>
  );
}

function ToolChecklist({
  busy,
  overMcp,
  tools,
  selectedToolIds,
  onToolToggle,
  onToolsChange,
}: {
  busy: boolean;
  overMcp: boolean;
  tools: ToolSummary[];
  selectedToolIds: Set<string>;
  onToolToggle: (toolId: string, checked: boolean) => void;
  onToolsChange: (toolIds: string[]) => void;
}) {
  if (tools.length === 0) {
    return <p className="text-muted-foreground text-sm">No tools available.</p>;
  }

  const selectedCount = tools.filter((tool) =>
    selectedToolIds.has(tool.id)
  ).length;
  const allSelected = selectedCount === tools.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <fieldset
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border"
      disabled={busy}
      id="create-profile-tool-list"
    >
      <legend className="sr-only">Tools</legend>
      <label className="flex cursor-pointer items-center gap-3 border-border border-b px-3 py-2.5 font-medium text-sm">
        <input
          checked={allSelected}
          className="size-4 rounded border-input accent-primary"
          onChange={() =>
            onToolsChange(allSelected ? [] : tools.map((tool) => tool.id))
          }
          ref={(element) => {
            if (element) {
              element.indeterminate = someSelected;
            }
          }}
          type="checkbox"
        />
        Tools
        <span className="ml-auto font-normal text-muted-foreground text-xs">
          {overMcp ? "Over MCP · " : ""}
          {selectedCount}/{tools.length}
        </span>
      </label>
      <ul className="min-h-0 overflow-y-auto py-1">
        {tools.map((tool) => (
          <li key={tool.id}>
            <label
              className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-3 py-2 transition-colors hover:bg-muted/50 sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]"
              title={tool.description || tool.name}
            >
              <input
                checked={selectedToolIds.has(tool.id)}
                className="size-4 shrink-0 rounded border-input accent-primary"
                onChange={(event) =>
                  onToolToggle(tool.id, event.target.checked)
                }
                type="checkbox"
              />
              <span className="truncate font-mono text-sm">{tool.name}</span>
              {tool.description ? (
                <span className="col-start-2 truncate text-muted-foreground text-xs sm:col-start-3 sm:text-sm">
                  {tool.description}
                </span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
