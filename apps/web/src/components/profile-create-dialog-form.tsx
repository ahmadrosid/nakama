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
import { Textarea } from "@nakama/ui/textarea";
import { cn } from "@nakama/ui/utils";
import { Tick02Icon } from "hugeicons-react";
import { type ChangeEvent, type RefObject, useState } from "react";

/** Select items cannot be empty strings, so the built-in chat uses a sentinel. */
export const BUILT_IN_AGENT = "builtin";

const PROMPT_SUGGESTIONS = [
  {
    label: "Research a topic",
    prompt:
      "Research a topic I give you on the web and summarize what matters, with sources.",
  },
  {
    label: "Draft emails",
    prompt:
      "Draft clear, short emails from my notes. Match my tone and keep each one under 150 words.",
  },
  {
    label: "Answer from our documents",
    prompt:
      "Answer questions using our documents. Say when the answer is not in them.",
  },
  {
    label: "Write reports",
    prompt:
      "Write a weekly report from the notes and files I share. Use short sections and bullet points.",
  },
];

const TOOL_LABELS = new Map([
  ["bash", "Run commands"],
  ["email", "Send email"],
  ["knowledge_base_search", "Search our documents"],
  ["read_file", "Read files"],
  ["web_fetch", "Open web pages"],
  ["web_search", "Search the web"],
  ["write_file", "Write files"],
]);

function toolLabel(tool: ToolSummary) {
  return TOOL_LABELS.get(tool.id) ?? tool.name;
}

export function ProfileCreateDialogForm({
  busy,
  submitError,
  name,
  prompt,
  onPromptChange,
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
  prompt: string;
  onPromptChange: (value: string) => void;
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
  const [changing, setChanging] = useState(false);

  const agentLabel =
    agentPresets.find((preset) => preset.id === agentId)?.label ?? "Nakama";

  const selectedTools = tools.filter((tool) => selectedToolIds.has(tool.id));

  const canActOutside = selectedTools.some(
    (tool) => tool.id === "email" || tool.id === "bash"
  );

  return (
    <div className="-m-1 flex min-h-0 flex-col gap-4 overflow-y-auto p-1">
      {submitError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {submitError}
        </p>
      ) : null}

      <Textarea
        aria-label="What do you need help with?"
        autoFocus
        className="min-h-28 resize-none rounded-2xl px-4 py-3 text-base"
        disabled={busy}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Example: Every Monday, summarize what our competitors posted last week."
        value={prompt}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Try:</span>
        {PROMPT_SUGGESTIONS.map((suggestion) => (
          <button
            className="rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
            disabled={busy}
            key={suggestion.label}
            onClick={() => onPromptChange(suggestion.prompt)}
            type="button"
          >
            {suggestion.label}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-sm">We will let it</h3>
          <button
            aria-expanded={changing}
            className="font-medium text-primary text-sm underline underline-offset-2"
            onClick={() => setChanging((value) => !value)}
            type="button"
          >
            {changing ? "Done" : "Change"}
          </button>
        </div>

        {selectedTools.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {selectedTools.map((tool) => (
              <li
                className="flex items-center gap-1.5 rounded-full border border-primary/15 bg-background px-3 py-1.5 text-sm"
                key={tool.id}
              >
                <Tick02Icon className="size-4 text-primary" />
                {toolLabel(tool)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        )}

        {canActOutside ? null : (
          <p className="text-muted-foreground text-sm">
            It will not send email or run commands.
          </p>
        )}

        {changing ? (
          <div className="flex flex-col gap-4 border-primary/15 border-t pt-4">
            <ToolChecklist
              busy={busy}
              onToolsChange={onToolsChange}
              onToolToggle={onToolToggle}
              overMcp={agentId !== BUILT_IN_AGENT}
              selectedToolIds={selectedToolIds}
              tools={tools}
            />

            <AgentFields
              agentId={agentId}
              agentLabel={agentLabel}
              agentPresets={agentPresets}
              busy={busy}
              onAgentChange={onAgentChange}
              onProfileIdChange={onProfileIdChange}
              profileId={profileId}
              profileIdHasValue={profileIdHasValue}
              profileIdHelpText={profileIdHelpText}
              profileIdValid={profileIdValid}
            />

            <AvatarPicker
              avatarInputRef={avatarInputRef}
              avatarPreview={avatarPreview}
              busy={busy}
              onAvatarSelected={onAvatarSelected}
              onClearAvatar={onClearAvatar}
            />
          </div>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <label className="font-semibold text-sm" htmlFor="create-profile-name">
          Name
        </label>
        <Input
          disabled={busy}
          id="create-profile-name"
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Optional. We will name it."
          value={name}
        />
      </div>
    </div>
  );
}

function AvatarPicker({
  avatarInputRef,
  avatarPreview,
  busy,
  onAvatarSelected,
  onClearAvatar,
}: {
  avatarInputRef: RefObject<HTMLInputElement | null>;
  avatarPreview: string | null;
  busy: boolean;
  onAvatarSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAvatar: () => void;
}) {
  return (
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
  );
}

function AgentFields({
  agentId,
  agentLabel,
  agentPresets,
  busy,
  onAgentChange,
  onProfileIdChange,
  profileId,
  profileIdHasValue,
  profileIdHelpText,
  profileIdValid,
}: {
  agentId: string;
  agentLabel: string;
  agentPresets: AcpAgentPresetSummary[];
  busy: boolean;
  onAgentChange: (agentId: string) => void;
  onProfileIdChange: (value: string) => void;
  profileId: string;
  profileIdHasValue: boolean;
  profileIdHelpText: string;
  profileIdValid: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
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
          "text-xs sm:col-span-2",
          profileIdHasValue && !profileIdValid
            ? "text-destructive"
            : "text-muted-foreground"
        )}
        id="create-profile-id-help"
      >
        {profileIdHelpText}
      </p>
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
      className="min-w-0 overflow-hidden rounded-xl border border-border"
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
      <ul className="max-h-[min(18rem,35dvh)] overflow-y-auto py-1">
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
              <span className="truncate text-sm">{toolLabel(tool)}</span>
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
