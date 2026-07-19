import { useReducer } from "react";
import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/use-auth";
import {
  OrgMemberAddDialog,
  OrgMemberEditDialog,
  OrgMemberInviteDialog,
  OrgMemberRemoveDialog,
  type OrgMemberAddCredentials,
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

type OrgMembersState = {
  inviteOpen: boolean;
  addOpen: boolean;
  editOpen: boolean;
  editingMember: OrgMemberSummary | null;
  removingMember: OrgMemberSummary | null;
  inviteEmail: string;
  inviteRole: OrgRole;
  addName: string;
  addEmail: string;
  addPhone: string;
  addRole: OrgRole;
  editName: string;
  editPhone: string;
  editRole: OrgRole;
  formError: string | null;
  secretHint: string | null;
  secretValue: string | null;
  addCredentials: OrgMemberAddCredentials | null;
  addCopyHint: string | null;
};

const initialOrgMembersState: OrgMembersState = {
  inviteOpen: false,
  addOpen: false,
  editOpen: false,
  editingMember: null,
  removingMember: null,
  inviteEmail: "",
  inviteRole: "member",
  addName: "",
  addEmail: "",
  addPhone: "",
  addRole: "member",
  editName: "",
  editPhone: "",
  editRole: "member",
  formError: null,
  secretHint: null,
  secretValue: null,
  addCredentials: null,
  addCopyHint: null,
};

type OrgMembersAction =
  | { type: "reset-invite" }
  | { type: "reset-add" }
  | { type: "reset-edit" }
  | { type: "clear-secrets" }
  | { type: "patch"; values: Partial<OrgMembersState> }
  | { type: "open-edit"; member: OrgMemberSummary };

function orgMembersReducer(state: OrgMembersState, action: OrgMembersAction): OrgMembersState {
  switch (action.type) {
    case "reset-invite":
      return {
        ...state,
        inviteEmail: "",
        inviteRole: "member",
        formError: null,
      };
    case "reset-add":
      return {
        ...state,
        addName: "",
        addEmail: "",
        addPhone: "",
        addRole: "member",
        formError: null,
        addCredentials: null,
        addCopyHint: null,
      };
    case "reset-edit":
      return {
        ...state,
        editingMember: null,
        editName: "",
        editPhone: "",
        editRole: "member",
        formError: null,
      };
    case "clear-secrets":
      return { ...state, secretHint: null, secretValue: null };
    case "open-edit":
      return {
        ...state,
        editingMember: action.member,
        editName: action.member.name ?? "",
        editPhone: action.member.phone ?? "",
        editRole: action.member.role,
        formError: null,
        editOpen: true,
      };
    case "patch":
      return { ...state, ...action.values };
    default:
      return state;
  }
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
  const [state, dispatch] = useReducer(orgMembersReducer, initialOrgMembersState);

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const members = data?.members ?? [];

  async function copySecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      dispatch({ type: "patch", values: { secretHint: "Copied to clipboard." } });
    } catch {
      dispatch({
        type: "patch",
        values: { secretHint: "Could not copy — select and copy manually." },
      });
    }
  }

  async function copyAddCredential(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      dispatch({ type: "patch", values: { addCopyHint: "Copied to clipboard." } });
    } catch {
      dispatch({
        type: "patch",
        values: { addCopyHint: "Could not copy — select and copy manually." },
      });
    }
  }

  function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault();
    dispatch({ type: "patch", values: { formError: null } });
    dispatch({ type: "clear-secrets" });

    const email = state.inviteEmail.trim();
    if (!email) {
      dispatch({ type: "patch", values: { formError: "Email is required." } });
      return;
    }

    inviteMutation.mutate(
      { email, role: state.inviteRole },
      {
        onSuccess: (result) => {
          dispatch({
            type: "patch",
            values: {
              secretValue: result.token,
              secretHint: "Share this invite token with the recipient.",
              inviteOpen: false,
            },
          });
          dispatch({ type: "reset-invite" });
        },
        onError: (err) =>
          dispatch({ type: "patch", values: { formError: formatError(err) } }),
      },
    );
  }

  function handleAddSubmit(event: React.FormEvent) {
    event.preventDefault();
    dispatch({ type: "patch", values: { formError: null, addCopyHint: null } });
    dispatch({ type: "clear-secrets" });

    const name = state.addName.trim();
    const email = state.addEmail.trim();
    const phone = state.addPhone.trim();

    if (!name || !email) {
      dispatch({ type: "patch", values: { formError: "Name and email are required." } });
      return;
    }

    addMutation.mutate(
      { name, email, phone, role: state.addRole },
      {
        onSuccess: (result) => {
          if (result.temporaryPassword) {
            dispatch({
              type: "patch",
              values: {
                addCredentials: {
                  email: result.member.email,
                  temporaryPassword: result.temporaryPassword,
                },
                addCopyHint: null,
                formError: null,
              },
            });
            return;
          }

          dispatch({ type: "patch", values: { addOpen: false } });
          dispatch({ type: "reset-add" });
        },
        onError: (err) =>
          dispatch({ type: "patch", values: { formError: formatError(err) } }),
      },
    );
  }

  function handleRoleChange(userId: string, role: OrgRole) {
    updateMemberMutation.mutate(
      { userId, request: { role } },
      { onError: (err) => dispatch({ type: "patch", values: { formError: formatError(err) } }) },
    );
  }

  function handleEditSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!state.editingMember) {
      return;
    }

    dispatch({ type: "patch", values: { formError: null } });
    updateMemberMutation.mutate(
      {
        userId: state.editingMember.userId,
        request: {
          name: state.editName,
          phone: state.editPhone,
          role: state.editRole,
        },
      },
      {
        onSuccess: () => {
          dispatch({ type: "patch", values: { editOpen: false } });
          dispatch({ type: "reset-edit" });
        },
        onError: (err) =>
          dispatch({ type: "patch", values: { formError: formatError(err) } }),
      },
    );
  }

  function handleRemove(member: OrgMemberSummary) {
    dispatch({
      type: "patch",
      values: { removingMember: member, formError: null },
    });
  }

  function handleRemoveConfirm() {
    if (!state.removingMember) {
      return;
    }

    dispatch({ type: "patch", values: { formError: null } });
    removeMutation.mutate(state.removingMember.userId, {
      onSuccess: () => dispatch({ type: "patch", values: { removingMember: null } }),
      onError: (err) =>
        dispatch({ type: "patch", values: { formError: formatError(err) } }),
    });
  }

  const statusLine = state.formError ?? (loadError ? formatError(loadError) : null);

  return (
    <>
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <OrgMembersCardHeader
            orgId={activeOrg.id}
            onInvite={() => {
              dispatch({ type: "reset-invite" });
              dispatch({ type: "clear-secrets" });
              dispatch({ type: "patch", values: { inviteOpen: true } });
            }}
            onAddMember={() => {
              dispatch({ type: "reset-add" });
              dispatch({ type: "clear-secrets" });
              dispatch({ type: "patch", values: { addOpen: true } });
            }}
          />

          {state.secretValue ? (
            <OrgMembersSecretBanner
              secretHint={state.secretHint}
              secretValue={state.secretValue}
              onCopy={() => void copySecret(state.secretValue!)}
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
              onEdit={(member) => dispatch({ type: "open-edit", member })}
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
        open={state.inviteOpen}
        inviteEmail={state.inviteEmail}
        inviteRole={state.inviteRole}
        formError={state.formError}
        pending={inviteMutation.isPending}
        onOpenChange={(open) => {
          dispatch({ type: "patch", values: { inviteOpen: open } });
          if (!open) {
            dispatch({ type: "reset-invite" });
          }
        }}
        onInviteEmailChange={(value) =>
          dispatch({ type: "patch", values: { inviteEmail: value } })
        }
        onInviteRoleChange={(value) =>
          dispatch({ type: "patch", values: { inviteRole: value } })
        }
        onSubmit={handleInviteSubmit}
      />

      <OrgMemberAddDialog
        open={state.addOpen}
        addName={state.addName}
        addEmail={state.addEmail}
        addPhone={state.addPhone}
        addRole={state.addRole}
        formError={state.formError}
        pending={addMutation.isPending}
        credentials={state.addCredentials}
        copyHint={state.addCopyHint}
        onOpenChange={(open) => {
          dispatch({ type: "patch", values: { addOpen: open } });
          if (!open) {
            dispatch({ type: "reset-add" });
          }
        }}
        onAddNameChange={(value) => dispatch({ type: "patch", values: { addName: value } })}
        onAddEmailChange={(value) => dispatch({ type: "patch", values: { addEmail: value } })}
        onAddPhoneChange={(value) => dispatch({ type: "patch", values: { addPhone: value } })}
        onAddRoleChange={(value) => dispatch({ type: "patch", values: { addRole: value } })}
        onCopyCredential={(value) => void copyAddCredential(value)}
        onSubmit={handleAddSubmit}
      />

      <OrgMemberEditDialog
        open={state.editOpen}
        editingMember={state.editingMember}
        editName={state.editName}
        editPhone={state.editPhone}
        editRole={state.editRole}
        formError={state.formError}
        pending={updateMemberMutation.isPending}
        onOpenChange={(open) => {
          dispatch({ type: "patch", values: { editOpen: open } });
          if (!open) {
            dispatch({ type: "reset-edit" });
          }
        }}
        onEditNameChange={(value) => dispatch({ type: "patch", values: { editName: value } })}
        onEditPhoneChange={(value) => dispatch({ type: "patch", values: { editPhone: value } })}
        onEditRoleChange={(value) => dispatch({ type: "patch", values: { editRole: value } })}
        onSubmit={handleEditSubmit}
      />

      <OrgMemberRemoveDialog
        member={state.removingMember}
        orgName={activeOrg.name}
        pending={removeMutation.isPending}
        formError={state.removingMember ? state.formError : null}
        onOpenChange={(open) => {
          if (!open) {
            dispatch({ type: "patch", values: { removingMember: null, formError: null } });
          }
        }}
        onConfirm={handleRemoveConfirm}
      />
    </>
  );
}
