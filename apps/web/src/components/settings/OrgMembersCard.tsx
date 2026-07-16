import { useState } from "react";
import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/use-auth";
import {
  OrgMemberAddDialog,
  OrgMemberEditDialog,
  OrgMemberInviteDialog,
} from "@/components/settings/org-member-dialogs";
import {
  OrgMembersCardHeader,
  OrgMembersSecretBanner,
} from "@/components/settings/org-members-card-header";
import { OrgMembersTable } from "@/components/settings/org-members-table";
import {
  useAddOrgMember,
  useInviteOrgMember,
  useOrgMembers,
  useRemoveOrgMember,
  useUpdateOrgMember,
} from "@/hooks/use-org-members";
import { formatError } from "@/lib/client";

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

  function clearSecrets() {
    setSecretHint(null);
    setSecretValue(null);
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
    clearSecrets();

    const email = inviteEmail.trim();
    if (!email) {
      setFormError("Email is required.");
      return;
    }

    inviteMutation.mutate(
      { email, role: inviteRole },
      {
        onSuccess: (result) => {
          setSecretValue(result.token);
          setSecretHint("Share this invite token with the recipient.");
          setInviteOpen(false);
          resetInviteForm();
        },
        onError: (err) => setFormError(formatError(err)),
      },
    );
  }

  function handleAddSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    clearSecrets();

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

  const statusLine = formError ?? (loadError ? formatError(loadError) : null);

  return (
    <>
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <OrgMembersCardHeader
            orgName={activeOrg.name}
            onInvite={() => {
              resetInviteForm();
              clearSecrets();
              setInviteOpen(true);
            }}
            onAddMember={() => {
              resetAddForm();
              clearSecrets();
              setAddOpen(true);
            }}
          />

          {secretValue ? (
            <OrgMembersSecretBanner
              secretHint={secretHint}
              secretValue={secretValue}
              onCopy={() => void copySecret(secretValue)}
            />
          ) : null}

          <div className="px-4 py-3">
            <OrgMembersTable
              members={members}
              currentUserEmail={user?.email}
              isLoading={isLoading}
              updatePending={updateMemberMutation.isPending}
              removePending={removeMutation.isPending}
              onRoleChange={handleRoleChange}
              onEdit={openEditDialog}
              onRemove={handleRemove}
            />

            {statusLine ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {statusLine}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <OrgMemberInviteDialog
        open={inviteOpen}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        formError={formError}
        pending={inviteMutation.isPending}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            resetInviteForm();
          }
        }}
        onInviteEmailChange={setInviteEmail}
        onInviteRoleChange={setInviteRole}
        onSubmit={handleInviteSubmit}
      />

      <OrgMemberAddDialog
        open={addOpen}
        addName={addName}
        addEmail={addEmail}
        addPhone={addPhone}
        addRole={addRole}
        formError={formError}
        pending={addMutation.isPending}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            resetAddForm();
          }
        }}
        onAddNameChange={setAddName}
        onAddEmailChange={setAddEmail}
        onAddPhoneChange={setAddPhone}
        onAddRoleChange={setAddRole}
        onSubmit={handleAddSubmit}
      />

      <OrgMemberEditDialog
        open={editOpen}
        editingMember={editingMember}
        editName={editName}
        editPhone={editPhone}
        editRole={editRole}
        formError={formError}
        pending={updateMemberMutation.isPending}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            resetEditForm();
          }
        }}
        onEditNameChange={setEditName}
        onEditPhoneChange={setEditPhone}
        onEditRoleChange={setEditRole}
        onSubmit={handleEditSubmit}
      />
    </>
  );
}
