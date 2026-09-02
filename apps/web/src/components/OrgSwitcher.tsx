import type { UserOrgSummary } from "@nakama/core/contract";
import { Add01Icon, ArrowDown01Icon, Edit03Icon } from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
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
import { useAuth } from "@/context/use-auth";
import { cn } from "@/lib/utils";

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

async function submitCreateOrg(input: {
  name: string;
  slug: string;
  createOrg: (request: { name: string; slug: string }) => Promise<unknown>;
  setError: (error: string | null) => void;
  setIsSubmitting: (value: boolean) => void;
  onSuccess: () => void;
}): Promise<void> {
  input.setError(null);

  const trimmedName = input.name.trim();
  const trimmedSlug = input.slug.trim().toLowerCase();

  if (!trimmedName) {
    input.setError("Organization name is required.");
    return;
  }

  if (!(trimmedSlug && SLUG_PATTERN.test(trimmedSlug))) {
    input.setError("Slug must use lowercase letters, numbers, and hyphens.");
    return;
  }

  input.setIsSubmitting(true);

  try {
    await input.createOrg({ name: trimmedName, slug: trimmedSlug });
    input.onSuccess();
  } catch (err) {
    input.setError(
      err instanceof Error ? err.message : "Failed to create organization"
    );
  } finally {
    input.setIsSubmitting(false);
  }
}

async function submitEditOrg(input: {
  orgId: string | undefined;
  name: string;
  updateOrg: (id: string, request: { name: string }) => Promise<unknown>;
  setError: (error: string | null) => void;
  setIsSubmitting: (value: boolean) => void;
  onSuccess: () => void;
}): Promise<void> {
  if (!input.orgId) {
    return;
  }

  input.setError(null);

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    input.setError("Organization name is required.");
    return;
  }

  input.setIsSubmitting(true);

  try {
    await input.updateOrg(input.orgId, { name: trimmedName });
    input.onSuccess();
  } catch (err) {
    input.setError(
      err instanceof Error ? err.message : "Failed to update organization"
    );
  } finally {
    input.setIsSubmitting(false);
  }
}

export function OrgSwitcher({ collapsed = false }: OrgSwitcherProps) {
  const { user, orgs, activeOrg, switchOrg, createOrg, updateOrg } = useAuth();
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

  if (!user || orgs.length === 0) {
    return null;
  }

  const label = activeOrg?.name ?? "Organization";
  const initial = label.charAt(0).toUpperCase();
  const trigger = (
    <Button
      aria-label={collapsed ? `Current organization: ${label}` : undefined}
      className={cn(
        "font-normal hover:bg-sidebar-accent/60 motion-reduce:transition-none",
        collapsed
          ? "sidebar-nav-link sidebar-nav-link--collapsed p-0"
          : "h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5 text-left"
      )}
      title={collapsed ? label : undefined}
      type="button"
      variant="ghost"
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

  function openEditDialog(org: UserOrgSummary) {
    editingOrgRef.current = org;
    setName(org.name);
    setError(null);
    setEditOpen(true);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    await submitCreateOrg({
      createOrg,
      name,
      onSuccess: () => {
        setCreateOpen(false);
        setName("");
        setSlug("");
        slugEditedRef.current = false;
      },
      setError,
      setIsSubmitting,
      slug,
    });
  }

  async function handleEdit(event: React.FormEvent) {
    event.preventDefault();
    await submitEditOrg({
      name,
      onSuccess: () => {
        setEditOpen(false);
        editingOrgRef.current = null;
        setName("");
      },
      orgId: editingOrgRef.current?.id,
      setError,
      setIsSubmitting,
      updateOrg,
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />

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
                      openEditDialog(org);
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
                onClick={() => {
                  setError(null);
                  setName("");
                  setSlug("");
                  slugEditedRef.current = false;
                  setCreateOpen(true);
                }}
              >
                <Add01Icon className="size-4" />
                Create organization
              </DropdownMenuItem>
            </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {user.isPlatformAdmin ? (
        <Dialog onOpenChange={setCreateOpen} open={createOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleCreate}>
              <div>
                <label
                  className="mb-1 block font-medium text-sm"
                  htmlFor="create-org-name"
                >
                  Name
                </label>
                <Input
                  id="create-org-name"
                  onChange={(event) => setName(event.target.value)}
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
                  onChange={(event) => {
                    slugEditedRef.current = true;
                    setSlug(event.target.value);
                  }}
                  placeholder="acme-corp"
                  required
                  value={slug}
                />
              </div>
              {error ? (
                <p className="text-destructive text-sm">{error}</p>
              ) : null}
              <DialogFooter>
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            editingOrgRef.current = null;
            setError(null);
          }
        }}
        open={editOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleEdit}>
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="edit-org-name"
              >
                Name
              </label>
              <Input
                id="edit-org-name"
                onChange={(event) => setName(event.target.value)}
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
    </>
  );
}
