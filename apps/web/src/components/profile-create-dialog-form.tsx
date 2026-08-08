import type { ToolSummary } from "@nakama/core/contract";
import { XIcon } from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-0 overflow-y-auto pr-1">
      {submitError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {submitError}
        </p>
      ) : null}

      <div className="mt-4 grid min-h-0 gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-6">
        <div className="space-y-4">
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

          <Field htmlFor="create-profile-id" label="Profile id">
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
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                {avatarPreview ? (
                  <img
                    alt=""
                    className="size-full object-cover"
                    src={avatarPreview}
                  />
                ) : (
                  <span className="font-medium text-lg text-muted-foreground">
                    {name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
              </div>
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

        <div className="space-y-4">
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
                  <p className="text-muted-foreground text-xs">
                    Adds on select. Remove unwanted ones below.
                  </p>
                </div>

                {selectedTools.length > 0 ? (
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <div className="max-h-32 overflow-y-auto pr-1">
                      <ul className="flex flex-wrap gap-2">
                        {selectedTools.map((tool) => (
                          <li key={tool.id}>
                            <button
                              aria-label={`Remove ${tool.name}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-foreground text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={busy}
                              onClick={() => onRemoveTool(tool.id)}
                              title={tool.name}
                              type="button"
                            >
                              <span className="max-w-52 truncate">
                                {tool.name}
                              </span>
                              <XIcon
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-muted-foreground text-xs" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
