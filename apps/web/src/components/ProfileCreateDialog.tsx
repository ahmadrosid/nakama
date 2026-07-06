import type { ToolSummary } from "@nakama/core/contract";
import { DELEGATE_CODING_TASK_TOOL_ID } from "@nakama/core/tools/protected";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useCodingHarnessSettings } from "@/hooks/use-coding-harness-settings";
import {
  useAssignToolMutation,
  useCreateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { fileToImageAttachment } from "@/lib/profile-images";
import { cn } from "@/lib/utils";

interface ProfileCreateDialogProps {
  open: boolean;
  tools: ToolSummary[];
  onCreated: (profileId: string) => void;
  onOpenChange: (open: boolean) => void;
}

const defaultCreatePrompt = "You are a helpful assistant.";
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function slugifyProfileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "profile"
  );
}

export function ProfileCreateDialog({
  open,
  tools,
  onCreated,
  onOpenChange,
}: ProfileCreateDialogProps) {
  const createMutation = useCreateProfileMutation();
  const uploadAvatarMutation = useUploadProfileAvatarMutation();
  const assignToolMutation = useAssignToolMutation();
  const { data: codingHarnessSettings } = useCodingHarnessSettings(open);
  const createAvatarInputRef = useRef<HTMLInputElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profileId, setProfileId] = useState("");
  const [profileIdEdited, setProfileIdEdited] = useState(false);
  const [prompt, setPrompt] = useState(defaultCreatePrompt);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [toolIds, setToolIds] = useState<string[]>([]);

  const busy =
    createMutation.isPending || uploadAvatarMutation.isPending || assignToolMutation.isPending;
  const profileIdTrimmed = profileId.trim();
  const profileIdValid =
    Boolean(profileIdTrimmed) && PROFILE_ID_PATTERN.test(profileIdTrimmed);
  const profileIdHasValue = profileId.length > 0;
  const profileIdHelpText = !profileIdHasValue || profileIdValid
    ? "Auto-generated from the name. Use letters, numbers, `_`, or `-`."
    : "Profile id must start with a letter or number and only use letters, numbers, `_`, or `-`.";
  const availableTools = tools.filter((tool) => !toolIds.includes(tool.id));
  const selectableTools = availableTools.filter((tool) => !isToolBlocked(tool, codingHarnessSettings?.configured));
  const selectedTools = tools.filter((tool) => toolIds.includes(tool.id));

  useEffect(() => {
    if (!open || profileIdEdited) {
      return;
    }

    setProfileId(name.trim() ? slugifyProfileName(name) : "");
  }, [name, open, profileIdEdited]);

  useEffect(() => {
    if (open) {
      return;
    }

    setSubmitError(null);
    setName("");
    setProfileId("");
    setProfileIdEdited(false);
    setPrompt(defaultCreatePrompt);
    setToolIds([]);
    setAvatarPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return null;
    });
    setAvatarFile(null);
  }, [open]);

  function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    setSubmitError(null);
    setAvatarPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return null;
    });
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleToolSelect(toolId: string) {
    if (!toolId || toolIds.includes(toolId)) {
      return;
    }

    setSubmitError(null);
    setToolIds((current) => [...current, toolId]);
  }

  function handleRemoveTool(toolId: string) {
    setSubmitError(null);
    setToolIds((current) => current.filter((id) => id !== toolId));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!name.trim() || !profileIdValid || busy) {
      setSubmitError(
        !name.trim()
          ? "Name is required."
          : "Profile id must start with a letter or number and only use letters, numbers, `_`, or `-`.",
      );
      return;
    }

    setSubmitError(null);

    try {
      const response = await createMutation.mutateAsync({
        id: profileIdTrimmed,
        name: name.trim(),
        systemPrompt: prompt.trim() || undefined,
      });

      if (avatarFile) {
        const attachment = await fileToImageAttachment(avatarFile);

        if (!attachment) {
          setSubmitError("Profile created, but the selected image could not be read.");
        } else {
          await uploadAvatarMutation.mutateAsync({
            profileId: response.profile.id,
            attachment,
          });
        }
      }

      for (const toolId of toolIds) {
        await assignToolMutation.mutateAsync({
          profileId: response.profile.id,
          toolId,
        });
      }

      onOpenChange(false);
      onCreated(response.profile.id);
    } catch (error) {
      setSubmitError(formatError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,42rem)] flex-col gap-6 overflow-hidden p-6 sm:max-w-4xl">
        <form className="flex min-h-0 flex-1 flex-col gap-6" onSubmit={handleSubmit}>
          <DialogHeader className="gap-2">
            <DialogTitle>Create profile</DialogTitle>
            <DialogDescription>
              Name, profile id, and system prompt for the new bot profile.
            </DialogDescription>
          </DialogHeader>

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
                    onChange={(event) => {
                      setSubmitError(null);
                      setName(event.target.value);
                    }}
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
                    onChange={(event) => {
                      setSubmitError(null);
                      setProfileIdEdited(true);
                      setProfileId(event.target.value);
                    }}
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
                        ref={createAvatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        disabled={busy}
                        onChange={handleAvatarSelected}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => createAvatarInputRef.current?.click()}
                      >
                        Choose image
                      </Button>
                      {avatarPreview ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setSubmitError(null);
                            setAvatarPreview((current) => {
                              if (current) {
                                URL.revokeObjectURL(current);
                              }

                              return null;
                            });
                            setAvatarFile(null);
                          }}
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
                  onChange={(event) => {
                    setSubmitError(null);
                    setPrompt(event.target.value);
                  }}
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
                          onValueChange={(value) => handleToolSelect(value != null ? String(value) : "")}
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
                        {availableTools.some(
                          (tool) => isToolBlocked(tool, codingHarnessSettings?.configured),
                        ) ? (
                          <p className="text-xs text-amber-600 dark:text-amber-300">
                            The coding delegation tool stays hidden until a coding harness is configured.
                          </p>
                        ) : null}
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
                                    onClick={() => handleRemoveTool(tool.id)}
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

          <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !profileIdValid}>
              {busy ? <Spinner className="size-4" /> : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function isToolBlocked(tool: ToolSummary, codingConfigured: boolean | undefined): boolean {
  return tool.id === DELEGATE_CODING_TASK_TOOL_ID && codingConfigured === false;
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
