import type { ToolSummary } from "@nakama/core/contract";
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
import { Cancel01Icon } from "hugeicons-react";
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
  selectableTools,
  selectedTools,
  onNameChange,
  onProfileIdChange,
  onAvatarSelected,
  onClearAvatar,
  onToolSelect,
  onRemoveTool,
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
  selectableTools: ToolSummary[];
  selectedTools: ToolSummary[];
  onNameChange: (value: string) => void;
  onProfileIdChange: (value: string) => void;
  onAvatarSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAvatar: () => void;
  onToolSelect: (toolId: string) => void;
  onRemoveTool: (toolId: string) => void;
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
                <div className="flex flex-col gap-2">
                  <Select
                    disabled={busy || selectableTools.length === 0}
                    onValueChange={(value) =>
                      onToolSelect(value == null ? "" : String(value))
                    }
                    value=""
                  >
                    <SelectTrigger
                      aria-label="Tool to assign"
                      className="w-full focus-visible:ring-1 focus-visible:ring-inset"
                    >
                      <SelectValue
                        placeholder={
                          selectableTools.length === 0
                            ? "All tools added"
                            : "Add a tool…"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableTools.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id}>
                          {tool.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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
