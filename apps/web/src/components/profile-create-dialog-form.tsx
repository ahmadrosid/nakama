import type { ToolSummary } from "@nakama/core/contract";
import { XIcon } from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function ProfileCreateDialogForm({
  busy,
  submitError,
  name,
  profileId,
  profileIdHasValue,
  profileIdValid,
  profileIdHelpText,
  prompt,
  avatarPreview,
  avatarInputRef,
  tools,
  selectableTools,
  selectedTools,
  onNameChange,
  onProfileIdChange,
  onPromptChange,
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
  prompt: string;
  avatarPreview: string | null;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  tools: ToolSummary[];
  selectableTools: ToolSummary[];
  selectedTools: ToolSummary[];
  onNameChange: (value: string) => void;
  onProfileIdChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onAvatarSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearAvatar: () => void;
  onToolSelect: (toolId: string) => void;
  onRemoveTool: (toolId: string) => void;
}) {
  return (
    <div className="min-h-0 overflow-y-auto pr-1">
      {submitError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <div className="mt-4 grid min-h-0 gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-6">
        <div className="space-y-4">
          <Field label="Name" htmlFor="create-profile-name">
            <Input
              id="create-profile-name"
              placeholder="Research assistant"
              value={name}
              disabled={busy}
              className="focus-visible:ring-1 focus-visible:ring-inset"
              autoFocus
              onChange={(event) => onNameChange(event.target.value)}
            />
          </Field>

          <Field label="Profile id" htmlFor="create-profile-id">
            <Input
              id="create-profile-id"
              placeholder="research-assistant"
              value={profileId}
              disabled={busy}
              className="font-mono text-sm focus-visible:ring-1 focus-visible:ring-inset aria-invalid:ring-1 aria-invalid:ring-inset"
              aria-invalid={profileIdHasValue && !profileIdValid}
              onChange={(event) => onProfileIdChange(event.target.value)}
            />
            <p
              className={cn(
                "text-xs",
                profileIdHasValue && !profileIdValid
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {profileIdHelpText}
            </p>
          </Field>

          <Field label="Avatar">
            <div className="flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-lg font-medium text-muted-foreground">
                    {name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  disabled={busy}
                  onChange={onAvatarSelected}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  Choose image
                </Button>
                {avatarPreview ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={onClearAvatar}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </Field>
        </div>

        <div className="space-y-4">
          <ExpandableTextarea
            label="System prompt"
            htmlFor="create-profile-prompt"
            value={prompt}
            disabled={busy}
            onChange={(event) => onPromptChange(event.target.value)}
          />

          <Field label="Tools">
            {tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tools available.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  <Select
                    value=""
                    disabled={busy || selectableTools.length === 0}
                    onValueChange={(value) => onToolSelect(value != null ? String(value) : "")}
                  >
                    <SelectTrigger
                      className="w-full focus-visible:ring-1 focus-visible:ring-inset"
                      aria-label="Tool to assign"
                    >
                      <SelectValue
                        placeholder={
                          selectableTools.length === 0 ? "All tools added" : "Add a tool…"
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
                  <p className="text-xs text-muted-foreground">
                    Selecting a tool adds it right away. Remove any you do not want below.
                  </p>
                </div>

                <div className="rounded-md border border-border bg-muted/20 p-2">
                  {selectedTools.length > 0 ? (
                    <div className="max-h-32 overflow-y-auto pr-1">
                      <ul className="flex flex-wrap gap-2">
                        {selectedTools.map((tool) => (
                          <li key={tool.id}>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={busy}
                              onClick={() => onRemoveTool(tool.id)}
                              aria-label={`Remove ${tool.name}`}
                              title={tool.name}
                            >
                              <span className="max-w-52 truncate">{tool.name}</span>
                              <XIcon className="size-3.5 text-muted-foreground" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No tools added yet.</p>
                  )}
                </div>
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-xs text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
