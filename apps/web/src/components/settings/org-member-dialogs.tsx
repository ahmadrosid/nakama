import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";
import { Copy01Icon, Mail01Icon } from "hugeicons-react";
import { Link } from "react-router-dom";
import { OrgMemberRoleSelect } from "@/components/settings/org-member-role-select";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const { data: emailSettings, isLoading: emailSettingsLoading } = useQuery(
    emailSettingsQueryOptions
  );
  const emailConfigured = emailSettings?.configured === true;

  return (
    <>
      {emailSettingsLoading || emailConfigured ? null : (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          Configure the shared email mailbox before you can invite members by
          email.{" "}
          <Link
            className="font-medium text-foreground underline-offset-4 hover:underline"
            to="/system?tab=tools"
          >
            Configure in System → Tools
          </Link>
        </p>
      )}
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label
            className="mb-1 block font-medium text-sm"
            htmlFor="invite-email"
          >
            Email
          </label>
          <Input
            id="invite-email"
            onChange={(event) => onInviteEmailChange(event.target.value)}
            placeholder="colleague@example.com"
            required
            type="email"
            value={inviteEmail}
          />
        </div>
        <div>
          <label
            className="mb-1 block font-medium text-sm"
            htmlFor="invite-role"
          >
            Role
          </label>
          <OrgMemberRoleSelect
            onChange={onInviteRoleChange}
            value={inviteRole}
          />
        </div>
        {formError ? (
          <p className="text-destructive text-sm">{formError}</p>
        ) : null}
        <Button
          className="w-full sm:w-auto"
          disabled={pending}
          size="sm"
          type="submit"
        >
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
    <Popover onOpenChange={onOpenChange} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <PopoverTrigger
                render={
                  <Button
                    aria-label="Invite by email"
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <Mail01Icon aria-hidden className="size-3.5" />
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
      <PopoverContent
        align="end"
        className="w-80 overflow-hidden p-0"
        sideOffset={4}
      >
        <div className="space-y-1 border-border border-b px-4 py-3">
          <p className="font-medium text-foreground text-sm">Invite member</p>
          <p className="text-muted-foreground text-xs">
            Send an invite by email. The recipient gets a link to join this
            organization.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <OrgMemberInviteForm
            formError={formError}
            inviteEmail={inviteEmail}
            inviteRole={inviteRole}
            onInviteEmailChange={onInviteEmailChange}
            onInviteRoleChange={onInviteRoleChange}
            onSubmit={onSubmit}
            pending={pending}
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
      <p className="font-medium text-sm">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          {value}
        </code>
        <Button
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={onCopy}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <Copy01Icon className="size-3.5" />
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        {credentials ? (
          <>
            <DialogHeader>
              <DialogTitle>Member added</DialogTitle>
              <DialogDescription>
                Share these login credentials once. They will not be shown
                again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <CredentialRow
                label="Email"
                onCopy={() => onCopyCredential(credentials.email)}
                value={credentials.email}
              />
              <CredentialRow
                label="Temporary password"
                onCopy={() => onCopyCredential(credentials.temporaryPassword)}
                value={credentials.temporaryPassword}
              />
              {copyHint ? (
                <p className="text-muted-foreground text-xs" role="status">
                  {copyHint}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add member</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div>
                <label
                  className="mb-1 block font-medium text-sm"
                  htmlFor="add-name"
                >
                  Name
                </label>
                <Input
                  id="add-name"
                  onChange={(event) => onAddNameChange(event.target.value)}
                  placeholder="Jane Doe"
                  required
                  value={addName}
                />
              </div>
              <div>
                <label
                  className="mb-1 block font-medium text-sm"
                  htmlFor="add-email"
                >
                  Email
                </label>
                <Input
                  id="add-email"
                  onChange={(event) => onAddEmailChange(event.target.value)}
                  placeholder="jane@example.com"
                  required
                  type="email"
                  value={addEmail}
                />
              </div>
              <div>
                <label
                  className="mb-1 block font-medium text-sm"
                  htmlFor="add-phone"
                >
                  Phone{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <Input
                  id="add-phone"
                  onChange={(event) => onAddPhoneChange(event.target.value)}
                  placeholder="+1234567890"
                  value={addPhone}
                />
              </div>
              <div>
                <label
                  className="mb-1 block font-medium text-sm"
                  htmlFor="add-role"
                >
                  Role
                </label>
                <OrgMemberRoleSelect
                  onChange={onAddRoleChange}
                  value={addRole}
                />
              </div>
              {formError ? (
                <p className="text-destructive text-sm">{formError}</p>
              ) : null}
              <DialogFooter>
                <Button disabled={pending} type="submit">
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="edit-name"
            >
              Name
            </label>
            <Input
              id="edit-name"
              onChange={(event) => onEditNameChange(event.target.value)}
              placeholder="Jane Doe"
              value={editName}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="edit-email"
            >
              Email
            </label>
            <Input
              disabled
              id="edit-email"
              readOnly
              type="email"
              value={editingMember?.email ?? ""}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="edit-phone"
            >
              Phone
            </label>
            <Input
              id="edit-phone"
              onChange={(event) => onEditPhoneChange(event.target.value)}
              placeholder="+1234567890"
              value={editPhone}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="edit-role"
            >
              Role
            </label>
            <OrgMemberRoleSelect onChange={onEditRoleChange} value={editRole} />
          </div>
          {formError ? (
            <p className="text-destructive text-sm">{formError}</p>
          ) : null}
          <DialogFooter>
            <Button disabled={pending} type="submit">
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
      onOpenChange={(open) => {
        if (!(open || pending)) {
          onOpenChange(false);
        }
      }}
      open={member !== null}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Remove member?</DialogTitle>
          <DialogDescription>
            Remove {displayName} from {orgName}? They will lose access to this
            organization.
          </DialogDescription>
          {member?.name ? (
            <p className="text-muted-foreground text-sm">{member.email}</p>
          ) : null}
        </DialogHeader>

        {formError ? (
          <p className="text-destructive text-sm" role="alert">
            {formError}
          </p>
        ) : null}

        <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {pending ? <Spinner className="size-4" /> : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
