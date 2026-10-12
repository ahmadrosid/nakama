import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Input } from "@nakama/ui/input";
import { toast } from "@nakama/ui/toast";
import { Cancel01Icon } from "hugeicons-react";
import { useReducer, useState } from "react";
import {
  type OrgMemberAddCredentials,
  OrgMemberAddDialog,
  OrgMemberEditDialog,
  OrgMemberRemoveDialog,
} from "@/components/settings/org-member-dialogs";
import {
  OrgIdRow,
  OrgMembersActions,
  OrgMembersSecretBanner,
} from "@/components/settings/org-members-card-header";
import { OrgMembersTable } from "@/components/settings/org-members-table";
import { useAuth } from "@/context/use-auth";
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
  addCopyHint: null,
  addCredentials: null,
  addEmail: "",
  addName: "",
  addOpen: false,
  addPhone: "",
  addRole: "member",
  editingMember: null,
  editName: "",
  editOpen: false,
  editPhone: "",
  editRole: "member",
  formError: null,
  inviteEmail: "",
  inviteOpen: false,
  inviteRole: "member",
  removingMember: null,
  secretHint: null,
  secretValue: null,
};

type OrgMembersAction =
  | { type: "reset-invite" }
  | { type: "reset-add" }
  | { type: "reset-edit" }
  | { type: "clear-secrets" }
  | { type: "patch"; values: Partial<OrgMembersState> }
  | { type: "open-edit"; member: OrgMemberSummary };

function orgMembersReducer(
  state: OrgMembersState,
  action: OrgMembersAction
): OrgMembersState {
  switch (action.type) {
    case "reset-invite":
      return {
        ...state,
        formError: null,
        inviteEmail: "",
        inviteRole: "member",
      };
    case "reset-add":
      return {
        ...state,
        addCopyHint: null,
        addCredentials: null,
        addEmail: "",
        addName: "",
        addPhone: "",
        addRole: "member",
        formError: null,
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
        editOpen: true,
        editPhone: action.member.phone ?? "",
        editRole: action.member.role,
        formError: null,
      };
    case "patch":
      return { ...state, ...action.values };
    default:
      return state;
  }
}

export function OrgMembersCard() {
  const { user, activeOrg, updateOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;

  const {
    data,
    isLoading,
    error: loadError,
  } = useOrgMembers(activeOrg?.role === "admin" ? orgId : null);

  const inviteMutation = useInviteOrgMember(orgId ?? "");
  const addMutation = useAddOrgMember(orgId ?? "");
  const updateMemberMutation = useUpdateOrgMember(orgId ?? "");
  const removeMutation = useRemoveOrgMember(orgId ?? "");

  const [tab, setTab] = useState<"members" | "settings">("members");
  const [state, dispatch] = useReducer(
    orgMembersReducer,
    initialOrgMembersState
  );

  if (!activeOrg || activeOrg.role !== "admin") {
    return null;
  }

  const members = data?.members ?? [];

  async function copySecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      dispatch({
        type: "patch",
        values: { secretHint: "Copied to clipboard." },
      });
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
      dispatch({
        type: "patch",
        values: { addCopyHint: "Copied to clipboard." },
      });
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
        onError: (err) =>
          dispatch({ type: "patch", values: { formError: formatError(err) } }),
        onSuccess: (result) => {
          if (result.delivered) {
            toast(`Invitation sent to ${email}.`);
          }

          dispatch({
            type: "patch",
            values: {
              inviteOpen: false,
              secretHint: result.token
                ? "Email delivery failed. Share this invite token manually."
                : null,
              secretValue: result.token,
            },
          });
          dispatch({ type: "reset-invite" });
        },
      }
    );
  }

  function handleAddSubmit(event: React.FormEvent) {
    event.preventDefault();
    dispatch({ type: "patch", values: { addCopyHint: null, formError: null } });
    dispatch({ type: "clear-secrets" });

    const name = state.addName.trim();
    const email = state.addEmail.trim();
    const phone = state.addPhone.trim();

    if (!(name && email)) {
      dispatch({
        type: "patch",
        values: { formError: "Name and email are required." },
      });

      return;
    }

    addMutation.mutate(
      { email, name, phone, role: state.addRole },
      {
        onError: (err) =>
          dispatch({ type: "patch", values: { formError: formatError(err) } }),
        onSuccess: (result) => {
          if (result.temporaryPassword) {
            dispatch({
              type: "patch",
              values: {
                addCopyHint: null,
                addCredentials: {
                  email: result.member.email,
                  temporaryPassword: result.temporaryPassword,
                },
                formError: null,
              },
            });

            return;
          }

          dispatch({ type: "patch", values: { addOpen: false } });
          dispatch({ type: "reset-add" });
        },
      }
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
        request: {
          name: state.editName,
          phone: state.editPhone,
          role: state.editRole,
        },
        userId: state.editingMember.userId,
      },
      {
        onError: (err) =>
          dispatch({ type: "patch", values: { formError: formatError(err) } }),
        onSuccess: () => {
          dispatch({ type: "patch", values: { editOpen: false } });
          dispatch({ type: "reset-edit" });
        },
      }
    );
  }

  function handleRemove(member: OrgMemberSummary) {
    dispatch({
      type: "patch",
      values: { formError: null, removingMember: member },
    });
  }

  function handleRemoveConfirm() {
    if (!state.removingMember) {
      return;
    }

    dispatch({ type: "patch", values: { formError: null } });
    removeMutation.mutate(state.removingMember.userId, {
      onError: (err) =>
        dispatch({ type: "patch", values: { formError: formatError(err) } }),
      onSuccess: () =>
        dispatch({ type: "patch", values: { removingMember: null } }),
    });
  }

  const statusLine =
    state.formError ?? (loadError ? formatError(loadError) : null);

  return (
    <>
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <div
            aria-label="Organization sections"
            className="flex items-center justify-between gap-3 px-4 py-2"
            role="tablist"
          >
            <div className="flex gap-1">
              {(
                [
                  ["members", "Members"],
                  ["settings", "Settings"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  aria-selected={tab === value}
                  key={value}
                  onClick={() => setTab(value)}
                  role="tab"
                  size="sm"
                  type="button"
                  variant={tab === value ? "secondary" : "ghost"}
                >
                  {label}
                </Button>
              ))}
            </div>
            {tab === "members" ? (
              <OrgMembersActions
                inviteEmail={state.inviteEmail}
                inviteFormError={state.formError}
                inviteOpen={state.inviteOpen}
                invitePending={inviteMutation.isPending}
                inviteRole={state.inviteRole}
                onAddMember={() => {
                  dispatch({ type: "reset-add" });
                  dispatch({ type: "clear-secrets" });
                  dispatch({ type: "patch", values: { addOpen: true } });
                }}
                onInviteEmailChange={(value) =>
                  dispatch({ type: "patch", values: { inviteEmail: value } })
                }
                onInviteOpenChange={(open) => {
                  dispatch({ type: "patch", values: { inviteOpen: open } });

                  if (open) {
                    dispatch({ type: "reset-invite" });
                    dispatch({ type: "clear-secrets" });
                  } else {
                    dispatch({ type: "reset-invite" });
                  }
                }}
                onInviteRoleChange={(value) =>
                  dispatch({ type: "patch", values: { inviteRole: value } })
                }
                onInviteSubmit={handleInviteSubmit}
              />
            ) : null}
          </div>

          {tab === "settings" ? (
            <>
              <InviteDomainsForm
                allowedDomains={activeOrg.allowedInviteDomains ?? []}
                key={activeOrg.id}
                onSave={(domains) =>
                  updateOrg(activeOrg.id, { allowedInviteDomains: domains })
                }
              />
              <OrgIdRow
                isTeam={Boolean(activeOrg.parentOrgId)}
                orgId={activeOrg.id}
              />
            </>
          ) : (
            <>
              {state.secretValue ? (
                <OrgMembersSecretBanner
                  onCopy={() => void copySecret(state.secretValue!)}
                  secretHint={state.secretHint}
                  secretValue={state.secretValue}
                />
              ) : null}

              <div>
                <OrgMembersTable
                  currentUserEmail={user?.email}
                  isLoading={isLoading}
                  members={members}
                  onEdit={(member) => dispatch({ member, type: "open-edit" })}
                  onRemove={handleRemove}
                  removePending={removeMutation.isPending}
                  updatePending={updateMemberMutation.isPending}
                />

                {statusLine ? (
                  <p
                    className="px-4 pt-2 pb-3 text-destructive text-sm"
                    role="alert"
                  >
                    {statusLine}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <OrgMembersCardDialogs
        addPending={addMutation.isPending}
        dispatch={dispatch}
        onAddSubmit={handleAddSubmit}
        onCopyAddCredential={copyAddCredential}
        onEditSubmit={handleEditSubmit}
        onRemoveConfirm={handleRemoveConfirm}
        orgName={activeOrg.name}
        removePending={removeMutation.isPending}
        state={state}
        updatePending={updateMemberMutation.isPending}
      />
    </>
  );
}

function InviteDomainsForm({
  allowedDomains,
  onSave,
}: {
  allowedDomains: string[];
  onSave: (domains: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string[]) {
    setSaving(true);
    setError(null);

    try {
      await onSave(next);
      toast("Invite settings saved.");
      return true;
    } catch (err) {
      setError(formatError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addDraft() {
    const added = draft
      .split(/[,\s]+/)
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);

    if (added.length === 0) {
      return;
    }

    if (await save([...new Set([...allowedDomains, ...added])])) {
      setDraft("");
    }
  }

  return (
    <div className="space-y-2 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-foreground text-sm">Who can join</p>
        {allowedDomains.length > 0 && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {allowedDomains.length}{" "}
            {allowedDomains.length === 1 ? "domain" : "domains"}
          </span>
        )}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {allowedDomains.length === 0 && (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            Anyone can be invited
          </p>
        )}
        {allowedDomains.map((domain) => (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            key={domain}
          >
            <span className="min-w-0 break-all">{domain}</span>
            <Button
              aria-label={`Remove ${domain}`}
              disabled={saving}
              onClick={() =>
                void save(allowedDomains.filter((entry) => entry !== domain))
              }
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Cancel01Icon aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 bg-background p-2">
          <Input
            aria-label="Add email domain"
            className="min-w-0 flex-1"
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addDraft();
              }
            }}
            placeholder="Add a domain, e.g. acme.com"
            value={draft}
          />
          <Button
            disabled={saving || draft.trim() === ""}
            onClick={() => void addDraft()}
            type="button"
          >
            Add
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OrgMembersCardDialogs({
  state,
  dispatch,
  orgName,
  addPending,
  updatePending,
  removePending,
  onAddSubmit,
  onEditSubmit,
  onRemoveConfirm,
  onCopyAddCredential,
}: {
  state: OrgMembersState;
  dispatch: React.Dispatch<OrgMembersAction>;
  orgName: string;
  addPending: boolean;
  updatePending: boolean;
  removePending: boolean;
  onAddSubmit: (event: React.FormEvent) => void;
  onEditSubmit: (event: React.FormEvent) => void;
  onRemoveConfirm: () => void;
  onCopyAddCredential: (value: string) => Promise<void>;
}) {
  return (
    <>
      <OrgMemberAddDialog
        addEmail={state.addEmail}
        addName={state.addName}
        addPhone={state.addPhone}
        addRole={state.addRole}
        copyHint={state.addCopyHint}
        credentials={state.addCredentials}
        formError={state.formError}
        onAddEmailChange={(value) =>
          dispatch({ type: "patch", values: { addEmail: value } })
        }
        onAddNameChange={(value) =>
          dispatch({ type: "patch", values: { addName: value } })
        }
        onAddPhoneChange={(value) =>
          dispatch({ type: "patch", values: { addPhone: value } })
        }
        onAddRoleChange={(value) =>
          dispatch({ type: "patch", values: { addRole: value } })
        }
        onCopyCredential={(value) => void onCopyAddCredential(value)}
        onOpenChange={(open) => {
          dispatch({ type: "patch", values: { addOpen: open } });

          if (!open) {
            dispatch({ type: "reset-add" });
          }
        }}
        onSubmit={onAddSubmit}
        open={state.addOpen}
        pending={addPending}
      />

      <OrgMemberEditDialog
        editingMember={state.editingMember}
        editName={state.editName}
        editPhone={state.editPhone}
        editRole={state.editRole}
        formError={state.formError}
        onEditNameChange={(value) =>
          dispatch({ type: "patch", values: { editName: value } })
        }
        onEditPhoneChange={(value) =>
          dispatch({ type: "patch", values: { editPhone: value } })
        }
        onEditRoleChange={(value) =>
          dispatch({ type: "patch", values: { editRole: value } })
        }
        onOpenChange={(open) => {
          dispatch({ type: "patch", values: { editOpen: open } });

          if (!open) {
            dispatch({ type: "reset-edit" });
          }
        }}
        onSubmit={onEditSubmit}
        open={state.editOpen}
        pending={updatePending}
      />

      <OrgMemberRemoveDialog
        formError={state.removingMember ? state.formError : null}
        member={state.removingMember}
        onConfirm={onRemoveConfirm}
        onOpenChange={(open) => {
          if (!open) {
            dispatch({
              type: "patch",
              values: { formError: null, removingMember: null },
            });
          }
        }}
        orgName={orgName}
        pending={removePending}
      />
    </>
  );
}
