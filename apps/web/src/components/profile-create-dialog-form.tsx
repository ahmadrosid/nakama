import type { ToolSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { cn } from "@nakama/ui/utils";
import { ArrowDown01Icon, Cancel01Icon } from "hugeicons-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";

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
  tools,
  selectedTools,
  onNameChange,
  onProfileIdChange,
  onAvatarSelected,
  onClearAvatar,
  onToolSelect,
  onRemoveTool,
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
  tools: ToolSummary[];
  selectedTools: ToolSummary[];
  onNameChange: (value: string) => void;
  onProfileIdChange: (value: string) => void;
  onAvatarSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAvatar: () => void;
  onToolSelect: (toolId: string) => void;
  onRemoveTool: (toolId: string) => void;
  onToolsChange: (toolIds: string[]) => void;
}) {
  return (
    <div className="min-h-0 space-y-4 overflow-y-auto">
      {submitError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {submitError}
        </p>
      ) : null}

      <div className="space-y-4">
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <Field htmlFor="create-profile-name" label="Name">
            <Input
              autoFocus
              className="focus-visible:ring-1 focus-visible:ring-inset"
              disabled={busy}
              id="create-profile-name"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Research assistant"
              value={name}
            />
          </Field>

          <Field htmlFor="create-profile-id" label="Agent id">
            <Input
              aria-invalid={profileIdHasValue && !profileIdValid}
              className="font-mono text-sm focus-visible:ring-1 focus-visible:ring-inset aria-invalid:ring-1 aria-invalid:ring-inset"
              disabled={busy}
              id="create-profile-id"
              onChange={(event) => onProfileIdChange(event.target.value)}
              placeholder="research-assistant"
              value={profileId}
            />
            <p
              className={cn(
                "text-xs",
                profileIdHasValue && !profileIdValid
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {profileIdHelpText}
            </p>
          </Field>

          <Field label="Avatar">
            <div className="flex items-center gap-3">
              {avatarPreview ? (
                <img
                  alt="Avatar preview"
                  className="size-10 shrink-0 rounded-md border border-border object-cover"
                  src={avatarPreview}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
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
                  Choose image
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
            </div>
          </Field>
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <Field label="Tools">
            {tools.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No tools available.
              </p>
            ) : (
              <div className="space-y-3">
                <ToolPicker
                  busy={busy}
                  onRemoveTool={onRemoveTool}
                  onToolSelect={onToolSelect}
                  onToolsChange={onToolsChange}
                  selectedTools={selectedTools}
                  tools={tools}
                />

                {selectedTools.length > 0 ? (
                  <div className="rounded-md border border-border">
                    <div className="max-h-40 overflow-y-auto">
                      <ul className="divide-y divide-border">
                        {selectedTools.map((tool) => (
                          <li key={tool.id}>
                            <button
                              aria-label={`Remove ${tool.name}`}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-foreground text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={busy}
                              onClick={() => onRemoveTool(tool.id)}
                              title={tool.name}
                              type="button"
                            >
                              <span className="min-w-0 truncate">
                                {tool.name}
                              </span>
                              <Cancel01Icon
                                aria-hidden
                                className="size-3.5 text-muted-foreground"
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Field>
        </div>
      </div>
    </div>
  );
}

function ToolPicker({
  busy,
  tools,
  selectedTools,
  onToolSelect,
  onRemoveTool,
  onToolsChange,
}: {
  busy: boolean;
  tools: ToolSummary[];
  selectedTools: ToolSummary[];
  onToolSelect: (toolId: string) => void;
  onRemoveTool: (toolId: string) => void;
  onToolsChange: (toolIds: string[]) => void;
}) {
  const selectedIds = new Set(selectedTools.map((tool) => tool.id));
  const allSelected = selectedTools.length === tools.length;
  const someSelected = selectedTools.length > 0 && !allSelected;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-8 w-full cursor-pointer select-none items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          selectedTools.length === 0 && "text-muted-foreground"
        )}
        disabled={busy}
        id="btn-create-profile-tools"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedTools.length === 0
            ? "Choose tools…"
            : `${selectedTools.length} of ${tools.length} tools selected`}
        </span>
        <ArrowDown01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="p-0" id="create-profile-tool-list">
        <label className="flex cursor-pointer items-center gap-3 border-border border-b px-3 py-2.5 font-medium text-sm">
          <input
            checked={allSelected}
            className="size-4 rounded border-input"
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
          Select all
          <span className="ml-auto font-normal text-muted-foreground text-xs">
            {selectedTools.length}/{tools.length}
          </span>
        </label>
        <ul className="max-h-72 overflow-y-auto py-1">
          {tools.map((tool) => (
            <li key={tool.id}>
              <label
                className="flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
                title={tool.description || tool.name}
              >
                <input
                  checked={selectedIds.has(tool.id)}
                  className="mt-0.5 size-4 shrink-0 rounded border-input"
                  onChange={(event) =>
                    event.target.checked
                      ? onToolSelect(tool.id)
                      : onRemoveTool(tool.id)
                  }
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{tool.name}</span>
                  {tool.description ? (
                    <span className="block truncate text-muted-foreground text-xs">
                      {tool.description}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start",
        className
      )}
    >
      <label
        className="shrink-0 text-foreground text-sm sm:w-24 sm:pt-2"
        htmlFor={htmlFor}
      >
        {label}
      </label>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}
