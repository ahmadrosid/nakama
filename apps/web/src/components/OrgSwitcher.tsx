import { useEffect, useState } from "react";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
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

interface OrgSwitcherProps {
  collapsed?: boolean;
}

export function OrgSwitcher({ collapsed = false }: OrgSwitcherProps) {
  const { user, orgs, activeOrg, switchOrg, createOrg } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
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

        <DropdownMenuContent align="start" className="w-64">
          {orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onSelect={() => {
                if (org.id !== activeOrg?.id) {
                  void switchOrg(org.id);
                }
              }}
            >
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.id === activeOrg?.id ? (
                <CheckIcon className="size-4 text-primary" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))}

          {user.isPlatformAdmin ? (
            <DropdownMenuItem
              onSelect={() => {
                setError(null);
                setCreateOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              Create organization
            </DropdownMenuItem>
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
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}
    </>
  );
}
