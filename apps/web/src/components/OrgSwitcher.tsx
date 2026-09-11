import type { UserOrgSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import { Add01Icon, ArrowDown01Icon, Edit03Icon } from "hugeicons-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/use-auth";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugifyOrganizationName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "org"
  );
}

function canEditOrg(org: UserOrgSummary, isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin || org.role === "admin";
}

function validateCreateOrg(name: string, slug: string): string | null {
  const trimmedName = name.trim();
  const trimmedSlug = slug.trim().toLowerCase();

  if (!trimmedName) {
    return "Organization name is required.";
  }

  if (!(trimmedSlug && SLUG_PATTERN.test(trimmedSlug))) {
    return "Slug must use lowercase letters, numbers, and hyphens.";
  }

  return null;
}

function orgSubmitError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return err.message;
  }

  return fallback;
}

interface OrgSwitcherProps {
  collapsed?: boolean;
}

function OrgSwitcherTrigger({
  className,
  collapsed,
  initial,
  label,
  ...props
}: {
  collapsed: boolean;
  initial: string;
  label: string;
} & ComponentProps<typeof Button>) {
  return (
    <Button
      aria-label={collapsed ? `Current organization: ${label}` : undefined}
      className={cn(
        "font-normal hover:bg-sidebar-accent/60 motion-reduce:transition-none",
        collapsed
          ? "sidebar-nav-link sidebar-nav-link--collapsed p-0"
          : "h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5 text-left",
        className
      )}
      title={collapsed ? label : undefined}
      type="button"
      variant="ghost"
      {...props}
    >
      {collapsed ? (
        <span className="flex size-8 items-center justify-center rounded-md bg-muted font-semibold text-foreground text-xs">
          {initial}
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
          <ArrowDown01Icon className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      )}
    </Button>
  );
}

function OrgSwitcherCreateDialog({
  error,
  isSubmitting,
  name,
  onNameChange,
  onOpenChange,
  onSlugChange,
  onSubmit,
  open,
  slug,
}: {
  error: string | null;
  isSubmitting: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSlugChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  open: boolean;
  slug: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="create-org-name"
            >
              Name
            </label>
            <Input
              id="create-org-name"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Acme Corp"
              required
              value={name}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="create-org-slug"
            >
              Slug
            </label>
            <Input
              id="create-org-slug"
              onChange={(event) => onSlugChange(event.target.value)}
              placeholder="acme-corp"
              required
              value={slug}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrgSwitcherEditDialog({
  error,
  isSubmitting,
  name,
  onNameChange,
  onOpenChange,
  onSubmit,
  open,
}: {
  error: string | null;
  isSubmitting: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit organization</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="edit-org-name"
            >
              Name
            </label>
            <Input
              id="edit-org-name"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Acme Corp"
              required
              value={name}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useOrgSwitcherDialogs() {
  const { createOrg, updateOrg } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const editingOrgRef = useRef<UserOrgSummary | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const slugEditedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!slugEditedRef.current) {
      setSlug(slugifyOrganizationName(name));
    }
  }, [name]);

  function openCreateDialog() {
    setError(null);
    setName("");
    setSlug("");
    slugEditedRef.current = false;
    setCreateOpen(true);
  }

  function openEditDialog(org: UserOrgSummary) {
    editingOrgRef.current = org;
    setName(org.name);
    setError(null);
    setEditOpen(true);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const validationError = validateCreateOrg(name, slug);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      await createOrg({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
      });
      setCreateOpen(false);
      setName("");
      setSlug("");
      slugEditedRef.current = false;
    } catch (err) {
      setError(orgSubmitError(err, "Failed to create organization"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingOrgRef.current) {
      return;
    }

    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Organization name is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      await updateOrg(editingOrgRef.current.id, { name: trimmedName });
      setEditOpen(false);
      editingOrgRef.current = null;
      setName("");
    } catch (err) {
      setError(orgSubmitError(err, "Failed to update organization"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEditOpenChange(open: boolean) {
    setEditOpen(open);
    if (!open) {
      editingOrgRef.current = null;
      setError(null);
    }
  }

  return {
    createOpen,
    editOpen,
    error,
    handleCreate,
    handleEdit,
    handleEditOpenChange,
    isSubmitting,
    name,
    openCreateDialog,
    openEditDialog,
    setCreateOpen,
    setName,
    setSlug,
    slug,
    slugEditedRef,
  };
}

export function OrgSwitcher({ collapsed = false }: OrgSwitcherProps) {
  const { user, orgs, activeOrg, switchOrg } = useAuth();
  const dialogs = useOrgSwitcherDialogs();

  if (!user || orgs.length === 0) {
    return null;
  }

  const label = activeOrg?.name ?? "Organization";
  const initial = label.charAt(0).toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <OrgSwitcherTrigger
              collapsed={collapsed}
              initial={initial}
              label={label}
            />
          }
        />

        <DropdownMenuContent
          align="start"
          className="w-64 p-0"
          side={collapsed ? "right" : "bottom"}
          sideOffset={8}
        >
          <div className="border-border/50 border-b px-2 py-1.5">
            <p className="font-medium text-muted-foreground text-xs">
              Select organization
            </p>
          </div>
          <div className="p-1">
            {orgs.map((org) => (
              <DropdownMenuItem
                className="pr-1"
                key={org.id}
                onClick={() => {
                  if (org.id !== activeOrg?.id) {
                    void switchOrg(org.id);
                  }
                }}
              >
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {canEditOrg(org, Boolean(user.isPlatformAdmin)) ? (
                  <Button
                    aria-label={`Edit ${org.name}`}
                    className="pointer-events-none shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/dropdown-menu-item:pointer-events-auto group-hover/dropdown-menu-item:opacity-100"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      dialogs.openEditDialog(org);
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Edit03Icon aria-hidden className="size-3.5" />
                  </Button>
                ) : null}
              </DropdownMenuItem>
            ))}
          </div>

          {user.isPlatformAdmin ? (
            <div className="border-border/50 border-t bg-muted/30 p-1">
              <DropdownMenuItem
                className="cursor-pointer text-muted-foreground"
                onClick={dialogs.openCreateDialog}
              >
                <Add01Icon className="size-4" />
                Create organization
              </DropdownMenuItem>
            </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {user.isPlatformAdmin ? (
        <OrgSwitcherCreateDialog
          error={dialogs.error}
          isSubmitting={dialogs.isSubmitting}
          name={dialogs.name}
          onNameChange={dialogs.setName}
          onOpenChange={dialogs.setCreateOpen}
          onSlugChange={(value) => {
            dialogs.slugEditedRef.current = true;
            dialogs.setSlug(value);
          }}
          onSubmit={(event) => void dialogs.handleCreate(event)}
          open={dialogs.createOpen}
          slug={dialogs.slug}
        />
      ) : null}

      <OrgSwitcherEditDialog
        error={dialogs.error}
        isSubmitting={dialogs.isSubmitting}
        name={dialogs.name}
        onNameChange={dialogs.setName}
        onOpenChange={dialogs.handleEditOpenChange}
        onSubmit={(event) => void dialogs.handleEdit(event)}
        open={dialogs.editOpen}
      />
    </>
  );
}
