import { parseAllowedWhatsAppPhones } from "@nakama/core/whatsapp-phones";
import { Delete02Icon } from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useSaveWhatsAppSettings } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

function formatAllowedPhone(digits: string): string {
  return `+${digits}`;
}

interface WhatsAppAllowedPhonesDialogProps {
  allowedPhones: string[];
  onAllowedPhonesChange: (phones: string[]) => void;
  onError?: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  open: boolean;
  profileId: string;
}

export function WhatsAppAllowedPhonesDialog({
  allowedPhones,
  onAllowedPhonesChange,
  onError,
  onOpenChange,
  onSaved,
  open,
  profileId,
}: WhatsAppAllowedPhonesDialogProps) {
  const saveMutation = useSaveWhatsAppSettings();
  const [newPhoneInput, setNewPhoneInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function saveAllowedPhones(nextPhones: string[], afterSuccess?: () => void) {
    onAllowedPhonesChange(nextPhones);
    setFormError(null);

    saveMutation.mutate(
      {
        allowedPhones: nextPhones.join(","),
        profileId: profileId.trim() || "default",
      },
      {
        onError: (error) => {
          const message = formatError(error);
          setFormError(message);
          onError?.(message);
        },
        onSuccess: () => {
          onSaved?.();
          afterSuccess?.();
        },
      }
    );
  }

  function addAllowedPhone() {
    let phones: string[];

    try {
      phones = parseAllowedWhatsAppPhones(newPhoneInput);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (phones.length === 0) {
      return;
    }

    saveAllowedPhones([...new Set([...allowedPhones, ...phones])], () => {
      setNewPhoneInput("");
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="p-6 sm:max-w-lg">
        <DialogHeader className="gap-2">
          <DialogTitle>Allowed numbers</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <p className="font-medium text-sm">Add number</p>
          <InputGroup>
            <InputGroupInput
              className="font-mono text-sm ring-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={saveMutation.isPending}
              onChange={(event) => {
                setNewPhoneInput(event.target.value);
                if (formError) {
                  setFormError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addAllowedPhone();
                }
              }}
              placeholder="+62812…"
              value={newPhoneInput}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                disabled={saveMutation.isPending || !newPhoneInput.trim()}
                onClick={addAllowedPhone}
                size="sm"
                type="button"
                variant="ghost"
              >
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {formError ? (
            <p
              className="rounded-md bg-destructive/10 px-2.5 py-1 text-destructive text-xs"
              role="alert"
            >
              {formError}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="font-medium text-sm">Numbers</p>
          <div className="h-40 space-y-2 overflow-y-auto">
            {allowedPhones.length > 0 ? (
              allowedPhones.map((phone) => (
                <div
                  className="flex min-h-12 items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                  key={phone}
                >
                  <code className="truncate text-sm">
                    {formatAllowedPhone(phone)}
                  </code>
                  <Button
                    aria-label={`Remove ${formatAllowedPhone(phone)}`}
                    disabled={saveMutation.isPending}
                    onClick={() =>
                      saveAllowedPhones(
                        allowedPhones.filter((entry) => entry !== phone)
                      )
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Delete02Icon aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="px-3 py-4 text-center text-muted-foreground text-xs">
                No numbers added.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
