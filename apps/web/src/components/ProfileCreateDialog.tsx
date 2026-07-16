import type { ToolSummary } from "@nakama/core/contract";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ProfileCreateDialogForm } from "@/components/profile-create-dialog-form";
import {
  useAssignToolMutation,
  useCreateProfileMutation,
  useUploadProfileAvatarMutation,
} from "@/hooks/use-resource-mutations";
import { formatError } from "@/lib/client";
import { fileToImageAttachment } from "@/lib/profile-images";

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
  const selectableTools = availableTools;
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

          <ProfileCreateDialogForm
            busy={busy}
            submitError={submitError}
            name={name}
            profileId={profileId}
            profileIdHasValue={profileIdHasValue}
            profileIdValid={profileIdValid}
            profileIdHelpText={profileIdHelpText}
            prompt={prompt}
            avatarPreview={avatarPreview}
            avatarInputRef={createAvatarInputRef}
            tools={tools}
            selectableTools={selectableTools}
            selectedTools={selectedTools}
            onNameChange={(value) => {
              setSubmitError(null);
              setName(value);
            }}
            onProfileIdChange={(value) => {
              setSubmitError(null);
              setProfileIdEdited(true);
              setProfileId(value);
            }}
            onPromptChange={(value) => {
              setSubmitError(null);
              setPrompt(value);
            }}
            onAvatarSelected={handleAvatarSelected}
            onClearAvatar={() => {
              setSubmitError(null);
              setAvatarPreview((current) => {
                if (current) {
                  URL.revokeObjectURL(current);
                }

                return null;
              });
              setAvatarFile(null);
            }}
            onToolSelect={handleToolSelect}
            onRemoveTool={handleRemoveTool}
          />

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
