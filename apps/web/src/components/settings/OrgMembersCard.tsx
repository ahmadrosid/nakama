import { useState } from "react";
import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";
import {
  useAddOrgMember,
  useInviteOrgMember,
  useOrgMembers,
  useRemoveOrgMember,
  useUpdateOrgMember,
} from "@/hooks/use-org-members";
import { formatError } from "@/lib/client";

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: OrgRole;
  disabled?: boolean;
  onChange: (role: OrgRole) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) {
          onChange(next as OrgRole);
        }
      }}
    >
      <SelectTrigger size="sm" aria-label="Member role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(ROLE_LABELS) as OrgRole[]).map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OrgMembersCard() {
  const { user, activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;

  const { data, isLoading, error: loadError } = useOrgMembers(
    activeOrg?.role === "admin" ? orgId : null,
  );
  const inviteMutation = useInviteOrgMember(orgId ?? "");
  const addMutation = useAddOrgMember(orgId ?? "");
  const updateMemberMutation = useUpdateOrgMember(orgId ?? "");
  const removeMutation = useRemoveOrgMember(orgId ?? "");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<OrgMemberSummary | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addRole, setAddRole] = useState<OrgRole>("member");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState<OrgRole>("member");
  const [formError, setFormError] = useState<string | null>(null);
  const [secretHint, setSecretHint] = useState<string | null>(null);
  const [secretValue, setSecretValue] = useState<string | null>(null);

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const members = data?.members ?? [];

  function resetInviteForm() {
    setInviteEmail("");
    setInviteRole("member");
    setFormError(null);
  }

  function resetAddForm() {
    setAddName("");
    setAddEmail("");
    setAddPhone("");
    setAddRole("member");
    setFormError(null);
  }

  function resetEditForm() {
    setEditingMember(null);
    setEditName("");
    setEditPhone("");
    setEditRole("member");
    setFormError(null);
  }

  async function copySecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSecretHint("Copied to clipboard.");
    } catch {
      setSecretHint("Could not copy — select and copy manually.");
    }
  }

  function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSecretHint(null);
    setSecretValue(null);

    const email = inviteEmail.trim();
    if (!email) {
      setFormError("Email is required.");
      return;
    }

    inviteMutation.mutate({ email, role: inviteRole }, {
      onSuccess: (result) => {
        setSecretValue(result.token);
        setSecretHint("Share this invite token with the recipient.");
        setInviteOpen(false);
        resetInviteForm();
      },
      onError: (err) => setFormError(formatError(err)),
    });
  }

  function handleAddSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSecretHint(null);
    setSecretValue(null);

    const name = addName.trim();
    const email = addEmail.trim();
    const phone = addPhone.trim();

    if (!name || !email) {
      setFormError("Name and email are required.");
      return;
    }

    addMutation.mutate(
      { name, email, phone, role: addRole },
      {
        onSuccess: (result) => {
          if (result.temporaryPassword) {
            setSecretValue(result.temporaryPassword);
            setSecretHint("Share this temporary password once. It will not be shown again.");
          }
          setAddOpen(false);
          resetAddForm();
        },
        onError: (err) => setFormError(formatError(err)),
      },
    );
  }

  function handleRoleChange(userId: string, role: OrgRole) {
    updateMemberMutation.mutate(
      { userId, request: { role } },
      { onError: (err) => setFormError(formatError(err)) },
    );
  }

  function openEditDialog(member: OrgMemberSummary) {
    setEditingMember(member);
    setEditName(member.name ?? "");
    setEditPhone(member.phone ?? "");
    setEditRole(member.role);
    setFormError(null);
    setEditOpen(true);
  }

  function handleEditSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingMember) {
      return;
    }

    setFormError(null);
    updateMemberMutation.mutate(
      {
        userId: editingMember.userId,
        request: {
          name: editName,
          phone: editPhone,
          role: editRole,
        },
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          resetEditForm();
        },
        onError: (err) => setFormError(formatError(err)),
      },
    );
  }

  function handleRemove(userId: string, email: string) {
    if (!window.confirm(`Remove ${email} from ${activeOrg!.name}?`)) {
      return;
    }

    setFormError(null);
    removeMutation.mutate(userId, {
      onError: (err) => setFormError(formatError(err)),
    });
  }

  const statusLine =
    formError ?? (loadError ? formatError(loadError) : null);

  return (
    <>
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Organization</p>
              <p className="text-xs text-muted-foreground">
                {activeOrg.name} · manage members and roles
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  resetInviteForm();
                  setSecretHint(null);
                  setSecretValue(null);
                  setInviteOpen(true);
                }}
              >
                <PlusIcon className="size-3.5" aria-hidden="true" />
                Invite
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  resetAddForm();
                  setSecretHint(null);
                  setSecretValue(null);
                  setAddOpen(true);
                }}
              >
                <UserPlusIcon className="size-3.5" aria-hidden="true" />
                Add member
              </Button>
            </div>
          </div>

          {secretValue ? (
            <div className="space-y-2 px-4 py-3">
              {secretHint ? (
                <p className="text-xs text-emerald-200" role="status">
                  {secretHint}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
                  {secretValue}
                </code>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Copy"
                  onClick={() => void copySecret(secretValue)}
                >
                  <CopyIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          <div className="px-4 py-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Loading members…
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Member</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {members.map((member) => {
                      const isSelf = member.email === user?.email;
                      const displayName = member.name?.trim() || member.email;

                      return (
                        <tr key={member.userId}>
                          <td className="px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">
                                {displayName}
                                {isSelf ? (
                                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                    (you)
                                  </span>
                                ) : null}
                              </p>
                              {member.name ? (
                                <p className="truncate text-xs text-muted-foreground">
                                  {member.email}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <RoleSelect
                              value={member.role}
                              disabled={updateMemberMutation.isPending}
                              onChange={(role) => handleRoleChange(member.userId, role)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground"
                                aria-label={`Edit ${displayName}`}
                                disabled={updateMemberMutation.isPending}
                                onClick={() => openEditDialog(member)}
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={`Remove ${displayName}`}
                                disabled={removeMutation.isPending}
                                onClick={() => handleRemove(member.userId, member.email)}
                              >
                                <Trash2Icon className="size-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {statusLine ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {statusLine}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            resetInviteForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">
                Role
              </label>
              <RoleSelect
                value={inviteRole}
                onChange={setInviteRole}
              />
            </div>
            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            resetAddForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div>
              <label htmlFor="add-name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <Input
                id="add-name"
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                placeholder="Jane Doe"
                required
              />
            </div>
            <div>
              <label htmlFor="add-email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <Input
                id="add-email"
                type="email"
                value={addEmail}
                onChange={(event) => setAddEmail(event.target.value)}
                placeholder="jane@example.com"
                required
              />
            </div>
            <div>
              <label htmlFor="add-phone" className="mb-1 block text-sm font-medium">
                Phone
              </label>
              <Input
                id="add-phone"
                value={addPhone}
                onChange={(event) => setAddPhone(event.target.value)}
                placeholder="+1234567890"
              />
            </div>
            <div>
              <label htmlFor="add-role" className="mb-1 block text-sm font-medium">
                Role
              </label>
              <RoleSelect value={addRole} onChange={setAddRole} />
            </div>
            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending ? "Adding…" : "Add member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            resetEditForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label htmlFor="edit-name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label htmlFor="edit-email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <Input
                id="edit-email"
                type="email"
                value={editingMember?.email ?? ""}
                readOnly
                disabled
              />
            </div>
            <div>
              <label htmlFor="edit-phone" className="mb-1 block text-sm font-medium">
                Phone
              </label>
              <Input
                id="edit-phone"
                value={editPhone}
                onChange={(event) => setEditPhone(event.target.value)}
                placeholder="+1234567890"
              />
            </div>
            <div>
              <label htmlFor="edit-role" className="mb-1 block text-sm font-medium">
                Role
              </label>
              <RoleSelect value={editRole} onChange={setEditRole} />
            </div>
            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={updateMemberMutation.isPending}>
                {updateMemberMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
