import type { WhatsAppAllowedPhoneDetail } from "@nakama/core/contract";
import { parseAllowedWhatsAppPhones } from "@nakama/core/whatsapp-phones";
import { Button } from "@nakama/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
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
import { Delete02Icon, PencilEdit02Icon, Search01Icon } from "hugeicons-react";
import { useState } from "react";
import { useSaveWhatsAppSettings } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

type SortOrder = "recent" | "name";

const SORT_LABELS: Record<SortOrder, string> = {
  name: "Name A–Z",
  recent: "Recently added",
};

const ROW_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_72px] items-center gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_72px]";

function formatAllowedPhone(digits: string): string {
  return `+${digits}`;
}

function formatAddedAt(addedAt: string | null): string {
  if (!addedAt) {
    return "—";
  }

  const date = new Date(addedAt);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function matchesQuery(phone: string, name: string, query: string): boolean {
  const text = query.trim().toLowerCase();

  if (!text) {
    return true;
  }

  if (name.toLowerCase().includes(text)) {
    return true;
  }

  const digits = text.replace(/\D/g, "");

  return digits.length > 0 && phone.includes(digits);
}

function sortPhones(
  phones: string[],
  details: Record<string, WhatsAppAllowedPhoneDetail>,
  order: SortOrder
): string[] {
  const position = new Map(phones.map((phone, index) => [phone, index]));

  return [...phones].sort((a, b) => {
    if (order === "name") {
      const nameA = details[a]?.name ?? "";
      const nameB = details[b]?.name ?? "";

      if (!(nameA && nameB)) {
        return nameA ? -1 : nameB ? 1 : 0;
      }

      return nameA.localeCompare(nameB);
    }

    const addedA = details[a]?.addedAt ?? "";
    const addedB = details[b]?.addedAt ?? "";

    if (addedA !== addedB) {
      return addedB.localeCompare(addedA);
    }

    // Numbers without an add time keep their saved order, newest last.
    return (position.get(b) ?? 0) - (position.get(a) ?? 0);
  });
}

interface WhatsAppAllowedPhonesDialogProps {
  allowedPhoneDetails: Record<string, WhatsAppAllowedPhoneDetail>;
  allowedPhones: string[];
  onAllowedPhonesChange: (phones: string[]) => void;
  onError?: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  open: boolean;
  profileId: string;
}

export function WhatsAppAllowedPhonesDialog({
  allowedPhoneDetails,
  allowedPhones,
  onAllowedPhonesChange,
  onError,
  onOpenChange,
  onSaved,
  open,
  profileId,
}: WhatsAppAllowedPhonesDialogProps) {
  const saveMutation = useSaveWhatsAppSettings();
  const [newNameInput, setNewNameInput] = useState("");
  const [newPhoneInput, setNewPhoneInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const visiblePhones = sortPhones(
    allowedPhones.filter((phone) =>
      matchesQuery(phone, allowedPhoneDetails[phone]?.name ?? "", query)
    ),
    allowedPhoneDetails,
    sortOrder
  );

  function saveSettings(
    request: {
      allowedPhoneNames?: Record<string, string>;
      allowedPhones?: string[];
    },
    afterSuccess?: () => void
  ) {
    if (request.allowedPhones) {
      onAllowedPhonesChange(request.allowedPhones);
    }

    setFormError(null);

    saveMutation.mutate(
      {
        ...(request.allowedPhones && {
          allowedPhones: request.allowedPhones.join(","),
        }),
        ...(request.allowedPhoneNames && {
          allowedPhoneNames: request.allowedPhoneNames,
        }),
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

    const name = newNameInput.trim();

    saveSettings(
      {
        allowedPhoneNames: name
          ? Object.fromEntries(phones.map((phone) => [phone, name]))
          : undefined,
        allowedPhones: [...new Set([...allowedPhones, ...phones])],
      },
      () => {
        setNewNameInput("");
        setNewPhoneInput("");
        setQuery("");
        setJustAdded(phones);
      }
    );
  }

  function startEditing(phone: string) {
    setEditingPhone(phone);
    setEditingName(allowedPhoneDetails[phone]?.name ?? "");
  }

  function saveEditingName() {
    if (editingPhone === null) {
      return;
    }

    const phone = editingPhone;
    const name = editingName.trim();
    setEditingPhone(null);

    if (name === (allowedPhoneDetails[phone]?.name ?? "")) {
      return;
    }

    saveSettings({ allowedPhoneNames: { [phone]: name } });
  }

  function clearFormError() {
    if (formError) {
      setFormError(null);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="p-6 sm:max-w-2xl">
        <DialogHeader className="gap-2">
          <DialogTitle>Allowed numbers</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            addAllowedPhone();
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              aria-label="Name"
              disabled={saveMutation.isPending}
              maxLength={80}
              onChange={(event) => {
                setNewNameInput(event.target.value);
                clearFormError();
              }}
              placeholder="Name"
              value={newNameInput}
            />
            <Input
              aria-label="Number"
              className="font-mono"
              disabled={saveMutation.isPending}
              onChange={(event) => {
                setNewPhoneInput(event.target.value);
                clearFormError();
              }}
              placeholder="+62812…"
              value={newPhoneInput}
            />
            <Button
              disabled={saveMutation.isPending || !newPhoneInput.trim()}
              type="submit"
            >
              Add number
            </Button>
          </div>
          {formError ? (
            <p
              className="rounded-md bg-destructive/10 px-2.5 py-1 text-destructive text-xs"
              role="alert"
            >
              {formError}
            </p>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search01Icon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search numbers"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or number"
              value={query}
            />
          </div>
          <Select
            onValueChange={(next) =>
              setSortOrder(next === "name" ? "name" : "recent")
            }
            value={sortOrder}
          >
            <SelectTrigger aria-label="Sort" className="w-40">
              <SelectValue>{SORT_LABELS[sortOrder]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{SORT_LABELS.recent}</SelectItem>
              <SelectItem value="name">{SORT_LABELS.name}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <div
            className={`${ROW_GRID} border-b bg-muted/40 px-3 py-2 font-medium text-muted-foreground text-xs`}
          >
            <span>Name</span>
            <span>Number</span>
            <span className="hidden sm:block">Added</span>
            <span />
          </div>
          <div className="h-72 overflow-y-auto">
            {visiblePhones.map((phone) => {
              const name = allowedPhoneDetails[phone]?.name ?? "";
              const isJustAdded = justAdded.includes(phone);

              return (
                <div
                  className={`${ROW_GRID} min-h-11 border-b px-3 py-1 last:border-b-0 ${isJustAdded ? "bg-emerald-500/10" : ""}`}
                  key={phone}
                >
                  {editingPhone === phone ? (
                    <Input
                      aria-label={`Name for ${formatAllowedPhone(phone)}`}
                      autoFocus
                      className="h-8"
                      maxLength={80}
                      onBlur={saveEditingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveEditingName();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingPhone(null);
                        }
                      }}
                      value={editingName}
                    />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`truncate text-sm ${name ? "font-medium" : "text-muted-foreground"}`}
                      >
                        {name || "No name"}
                      </span>
                      {isJustAdded ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-[11px] text-emerald-700 dark:text-emerald-300">
                          Just added
                        </span>
                      ) : null}
                    </span>
                  )}
                  <code className="truncate text-xs">
                    {formatAllowedPhone(phone)}
                  </code>
                  <span className="hidden text-muted-foreground text-xs sm:block">
                    {formatAddedAt(allowedPhoneDetails[phone]?.addedAt ?? null)}
                  </span>
                  <span className="flex justify-end gap-1">
                    <Button
                      aria-label={`Edit name for ${formatAllowedPhone(phone)}`}
                      disabled={saveMutation.isPending}
                      onClick={() => startEditing(phone)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <PencilEdit02Icon aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      aria-label={`Remove ${formatAllowedPhone(phone)}`}
                      disabled={saveMutation.isPending}
                      onClick={() => setRemoveTarget(phone)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Delete02Icon aria-hidden="true" className="size-4" />
                    </Button>
                  </span>
                </div>
              );
            })}
            {visiblePhones.length === 0 ? (
              <p className="px-3 py-6 text-center text-muted-foreground text-xs">
                {allowedPhones.length === 0
                  ? "No numbers added."
                  : `No name or number matches “${query.trim()}”.`}
              </p>
            ) : null}
          </div>
          {query.trim() && allowedPhones.length > 0 ? (
            <p className="border-t px-3 py-2 text-muted-foreground text-xs">
              {visiblePhones.length} of {allowedPhones.length}
            </p>
          ) : null}
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
        {removeTarget === null ? null : (
          <ConfirmDialog
            confirmLabel="Remove"
            description={`Remove ${allowedPhoneDetails[removeTarget]?.name || formatAllowedPhone(removeTarget)} from allowed numbers?`}
            onClose={() => setRemoveTarget(null)}
            onConfirm={async () => {
              const nextPhones = allowedPhones.filter(
                (phone) => phone !== removeTarget
              );

              await saveMutation.mutateAsync({
                allowedPhones: nextPhones.join(","),
                profileId: profileId.trim() || "default",
              });
              onAllowedPhonesChange(nextPhones);
              onSaved?.();
            }}
            title="Remove WhatsApp number?"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
