import { useEffect, useState } from "react";
import {
  Building2Icon,
  ChevronsUpDownIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import type { UserOrgSummary } from "@nakama/core/contract";

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

interface OrgSwitcherProps {
  collapsed?: boolean;
}

export function OrgSwitcher({ collapsed = false }: OrgSwitcherProps) {
  const { user, orgs, activeOrg, switchOrg, createOrg, updateOrg } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<UserOrgSummary | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!slugEdited) {
      setSlug(slugifyOrganizationName(name));
    }
  }, [name, slugEdited]);

  if (!user || orgs.length === 0) {
    return null;
  }

  const label = activeOrg?.name ?? "Organization";

  function openEditDialog(org: UserOrgSummary) {
    setEditingOrg(org);
    setName(org.name);
    setError(null);
    setEditOpen(true);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();

    if (!trimmedName) {
      setError("Organization name is required.");
      return;
    }

    if (!trimmedSlug || !SLUG_PATTERN.test(trimmedSlug)) {
      setError("Slug must use lowercase letters, numbers, and hyphens.");
      return;
    }

    setIsSubmitting(true);

    try {
      await createOrg({ name: trimmedName, slug: trimmedSlug });
      setCreateOpen(false);
      setName("");
      setSlug("");
      setSlugEdited(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingOrg) {
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
      await updateOrg(editingOrg.id, { name: trimmedName });
      setEditOpen(false);
      setEditingOrg(null);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update organization");
    } finally {
      setIsSubmitting(false);
    }
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      title={collapsed ? label : undefined}
      className={cn(
        "h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left font-normal hover:bg-sidebar-accent/60",
        collapsed ? "size-9 justify-center px-0" : "w-full",
      )}
      aria-label={collapsed ? `Current organization: ${label}` : undefined}
    >
      <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        </>
      ) : null}
    </Button>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />

        <DropdownMenuContent align="start" className="w-64 p-0">
          <div className="p-1">
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                className="pr-1"
                onClick={() => {
                  if (org.id !== activeOrg?.id) {
                    void switchOrg(org.id);
                  }
                }}
              >
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {canEditOrg(org, Boolean(user.isPlatformAdmin)) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="pointer-events-none shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/dropdown-menu-item:pointer-events-auto group-hover/dropdown-menu-item:opacity-100 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100"
                    aria-label={`Edit ${org.name}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openEditDialog(org);
                    }}
                  >
                    <PencilIcon className="size-3.5" aria-hidden />
                  </Button>
                ) : null}
              </DropdownMenuItem>
            ))}
          </div>

          {user.isPlatformAdmin ? (
            <div className="border-t border-border/50 bg-muted/30 p-1">
              <DropdownMenuItem
                className="text-muted-foreground"
                onClick={() => {
                  setError(null);
                  setName("");
                  setSlug("");
                  setSlugEdited(false);
                  setCreateOpen(true);
                }}
              >
                <PlusIcon className="size-4" />
                Create organization
              </DropdownMenuItem>
            </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {user.isPlatformAdmin ? (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="create-org-name" className="mb-1 block text-sm font-medium">
                  Name
                </label>
                <Input
                  id="create-org-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acme Corp"
                  required
                />
              </div>
              <div>
                <label htmlFor="create-org-slug" className="mb-1 block text-sm font-medium">
                  Slug
                </label>
                <Input
                  id="create-org-slug"
                  value={slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(event.target.value);
                  }}
                  placeholder="acme-corp"
                  required
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditingOrg(null);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label htmlFor="edit-org-name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <Input
                id="edit-org-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Corp"
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
