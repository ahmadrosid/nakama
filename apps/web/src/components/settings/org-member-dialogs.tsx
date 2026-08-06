import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, MailIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrgMemberRoleSelect } from "@/components/settings/org-member-role-select";
import { emailSettingsQueryOptions } from "@/hooks/use-email-settings";

export type OrgMemberAddCredentials = {
  email: string;
  temporaryPassword: string;
};

function OrgMemberInviteForm({
  inviteEmail,
  inviteRole,
  formError,
  pending,
  onInviteEmailChange,
  onInviteRoleChange,
  onSubmit,
}: {
  inviteEmail: string;
  inviteRole: OrgRole;
  formError: string | null;
  pending: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: OrgRole) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { data: emailSettings, isLoading: emailSettingsLoading } = useQuery(emailSettingsQueryOptions);
  const emailConfigured = emailSettings?.configured === true;

  return (
    <>
      {!emailSettingsLoading && !emailConfigured ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Configure the shared email mailbox before you can invite members by email.{" "}
          <Link
            to="/system?tab=tools"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Configure in System → Tools
          </Link>
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="invite-email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <Input
            id="invite-email"
            type="email"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.target.value)}
            placeholder="colleague@example.com"
            required
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">
            Role
          </label>
          <OrgMemberRoleSelect value={inviteRole} onChange={onInviteRoleChange} />
        </div>
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <Button type="submit" size="sm" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Sending…" : "Send invite"}
        </Button>
      </form>
    </>
  );
}

export function OrgMemberInvitePopover({
  open,
  inviteEmail,
  inviteRole,
  formError,
  pending,
  onOpenChange,
  onInviteEmailChange,
  onInviteRoleChange,
  onSubmit,
}: {
  open: boolean;
  inviteEmail: string;
  inviteRole: OrgRole;
  formError: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: OrgRole) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="Invite by email"
                  >
                    <MailIcon className="size-3.5" aria-hidden />
                  </Button>
                }
              />
            </span>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          Invite by email
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={4} className="w-80 overflow-hidden p-0">
        <div className="space-y-1 border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-foreground">Invite member</p>
          <p className="text-xs text-muted-foreground">
            Send an invite by email. The recipient gets a link to join this organization.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <OrgMemberInviteForm
          inviteEmail={inviteEmail}
          inviteRole={inviteRole}
          formError={formError}
          pending={pending}
          onInviteEmailChange={onInviteEmailChange}
          onInviteRoleChange={onInviteRoleChange}
          onSubmit={onSubmit}
        />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          {value}
        </code>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={onCopy}
        >
          <CopyIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function OrgMemberAddDialog({
  open,
  addName,
  addEmail,
  addPhone,
  addRole,
  formError,
  pending,
  credentials,
  copyHint,
  onOpenChange,
  onAddNameChange,
  onAddEmailChange,
  onAddPhoneChange,
  onAddRoleChange,
  onCopyCredential,
  onSubmit,
}: {
  open: boolean;
  addName: string;
  addEmail: string;
  addPhone: string;
  addRole: OrgRole;
  formError: string | null;
  pending: boolean;
  credentials: OrgMemberAddCredentials | null;
  copyHint: string | null;
  onOpenChange: (open: boolean) => void;
  onAddNameChange: (value: string) => void;
  onAddEmailChange: (value: string) => void;
  onAddPhoneChange: (value: string) => void;
  onAddRoleChange: (role: OrgRole) => void;
  onCopyCredential: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {credentials ? (
          <>
            <DialogHeader>
              <DialogTitle>Member added</DialogTitle>
              <DialogDescription>
                Share these login credentials once. They will not be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <CredentialRow
                label="Email"
                value={credentials.email}
                onCopy={() => onCopyCredential(credentials.email)}
              />
              <CredentialRow
                label="Temporary password"
                value={credentials.temporaryPassword}
                onCopy={() => onCopyCredential(credentials.temporaryPassword)}
              />
              {copyHint ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {copyHint}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add member</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label htmlFor="add-name" className="mb-1 block text-sm font-medium">
                  Name
                </label>
                <Input
                  id="add-name"
                  value={addName}
                  onChange={(event) => onAddNameChange(event.target.value)}
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
                  onChange={(event) => onAddEmailChange(event.target.value)}
                  placeholder="jane@example.com"
                  required
                />
              </div>
              <div>
                <label htmlFor="add-phone" className="mb-1 block text-sm font-medium">
                  Phone{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="add-phone"
                  value={addPhone}
                  onChange={(event) => onAddPhoneChange(event.target.value)}
                  placeholder="+1234567890"
                />
              </div>
              <div>
                <label htmlFor="add-role" className="mb-1 block text-sm font-medium">
                  Role
                </label>
                <OrgMemberRoleSelect value={addRole} onChange={onAddRoleChange} />
              </div>
              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Adding…" : "Add member"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OrgMemberEditDialog({
  open,
  editingMember,
  editName,
  editPhone,
  editRole,
  formError,
  pending,
  onOpenChange,
  onEditNameChange,
  onEditPhoneChange,
  onEditRoleChange,
  onSubmit,
}: {
  open: boolean;
  editingMember: OrgMemberSummary | null;
  editName: string;
  editPhone: string;
  editRole: OrgRole;
  formError: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onEditNameChange: (value: string) => void;
  onEditPhoneChange: (value: string) => void;
  onEditRoleChange: (role: OrgRole) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="edit-name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <Input
              id="edit-name"
              value={editName}
              onChange={(event) => onEditNameChange(event.target.value)}
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
              onChange={(event) => onEditPhoneChange(event.target.value)}
              placeholder="+1234567890"
            />
          </div>
          <div>
            <label htmlFor="edit-role" className="mb-1 block text-sm font-medium">
              Role
            </label>
            <OrgMemberRoleSelect value={editRole} onChange={onEditRoleChange} />
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrgMemberRemoveDialog({
  member,
  orgName,
  pending,
  formError,
  onOpenChange,
  onConfirm,
}: {
  member: OrgMemberSummary | null;
  orgName: string;
  pending: boolean;
  formError?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const displayName = member?.name?.trim() || member?.email || "this member";

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Remove member?</DialogTitle>
          <DialogDescription>
            Remove {displayName} from {orgName}? They will lose access to this organization.
          </DialogDescription>
          {member?.name ? (
            <p className="text-sm text-muted-foreground">{member.email}</p>
          ) : null}
        </DialogHeader>

        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}

        <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner className="size-4" /> : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
