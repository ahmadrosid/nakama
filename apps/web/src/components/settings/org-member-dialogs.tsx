import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { Spinner } from "@nakama/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { Copy01Icon, Search01Icon, Tick02Icon } from "hugeicons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { OrgMemberRoleCards } from "@/components/settings/org-member-role-select";
import { emailSettingsQueryOptions } from "@/hooks/use-app-queries";

const ROLE_NAMES: Record<OrgMemberSummary["role"], string> = {
  admin: "Org admin",
  member: "Member",
  viewer: "Viewer",
};

function memberInitials(member: OrgMemberSummary) {
  const source = member.name?.trim() || member.email;

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function OrgMemberPicker({
  members,
  isLoading,
  name,
  value,
  disabled,
  onChange,
}: {
  members: OrgMemberSummary[];
  isLoading: boolean;
  name: string;
  value: string;
  disabled: boolean;
  onChange: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const visible = members.filter(
    (member) =>
      !needle ||
      member.email.toLowerCase().includes(needle) ||
      (member.name ?? "").toLowerCase().includes(needle)
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 border-border border-b bg-muted/50 px-3">
        <Search01Icon aria-hidden className="size-4 text-muted-foreground" />
        <input
          aria-label="Search members"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search members"
          value={query}
        />
      </div>
      <div className="max-h-56 divide-y divide-border overflow-y-auto">
        {isLoading && (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            Loading members…
          </p>
        )}
        {visible.map((member) => {
          const selected = member.userId === value;

          return (
            <label
              className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 ${
                selected ? "bg-primary/10" : "bg-background"
              }`}
              key={member.userId}
            >
              <input
                checked={selected}
                className="sr-only"
                disabled={disabled}
                name={name}
                onChange={() => onChange(member.userId)}
                type="radio"
                value={member.userId}
              />
              <span
                aria-hidden
                className={`flex size-8 shrink-0 items-center justify-center rounded-full font-medium text-xs ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {memberInitials(member)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">
                  {member.name?.trim() || member.email}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {member.email} · {ROLE_NAMES[member.role]}
                </span>
              </span>
              {selected && (
                <Tick02Icon aria-hidden className="size-4 text-primary" />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

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
  onCancel,
  onSubmit,
}: {
  inviteEmail: string;
  inviteRole: OrgRole;
  formError: string | null;
  pending: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: OrgRole) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { data: emailSettings, isLoading: emailSettingsLoading } = useQuery(
    emailSettingsQueryOptions
  );

  const emailConfigured = emailSettings?.configured === true;

  return (
    <form onSubmit={onSubmit}>
      <div className="space-y-4 p-4">
        {emailSettingsLoading || emailConfigured ? null : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
            Email is not configured. You can still create an invite and share
            its token manually.{" "}
            <Link
              className="font-medium text-foreground underline-offset-4 hover:underline"
              to="/customize/tools"
            >
              Configure in Customize → Tools
            </Link>
          </p>
        )}
        <div>
          <label
            className="mb-1.5 block font-medium text-sm"
            htmlFor="invite-email"
          >
            Email
          </label>
          <Input
            className="h-10 rounded-xl"
            id="invite-email"
            onChange={(event) => onInviteEmailChange(event.target.value)}
            placeholder="colleague@example.com"
            required
            type="email"
            value={inviteEmail}
          />
        </div>
        <div>
          <p className="mb-1.5 font-medium text-sm">Role</p>
          <OrgMemberRoleCards
            onChange={onInviteRoleChange}
            value={inviteRole}
          />
        </div>
        {formError ? (
          <p className="text-destructive text-sm">{formError}</p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t bg-muted/50 p-4">
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={pending} type="submit">
          {pending ? "Sending…" : "Send invite"}
        </Button>
      </div>
    </form>
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
      <PopoverTrigger
        render={
          <Button aria-label="Invite by email" type="button" variant="outline">
            Invite by email
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-96 overflow-hidden p-0"
        sideOffset={4}
      >
        <div className="space-y-1 border-border border-b px-4 py-3">
          <p className="font-medium text-foreground text-sm">Invite member</p>
          <p className="text-muted-foreground text-xs">
            Send an invite by email. The recipient gets a link to join this
            organization.
          </p>
        </div>
        <OrgMemberInviteForm
          formError={formError}
          inviteEmail={inviteEmail}
          inviteRole={inviteRole}
          onCancel={() => onOpenChange(false)}
          onInviteEmailChange={onInviteEmailChange}
          onInviteRoleChange={onInviteRoleChange}
          onSubmit={onSubmit}
          pending={pending}
        />
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
      <DialogContent className="sm:max-w-lg">
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-1.5 block font-medium text-sm"
                    htmlFor="add-name"
                  >
                    Name
                  </label>
                  <Input
                    className="h-10 rounded-xl"
                    id="add-name"
                    onChange={(event) => onAddNameChange(event.target.value)}
                    placeholder="Jane Doe"
                    required
                    value={addName}
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block font-medium text-sm"
                    htmlFor="add-phone"
                  >
                    Phone{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <Input
                    className="h-10 rounded-xl"
                    id="add-phone"
                    onChange={(event) => onAddPhoneChange(event.target.value)}
                    placeholder="+1234567890"
                    value={addPhone}
                  />
                </div>
              </div>
              <div>
                <label
                  className="mb-1.5 block font-medium text-sm"
                  htmlFor="add-email"
                >
                  Email
                </label>
                <Input
                  className="h-10 rounded-xl"
                  id="add-email"
                  onChange={(event) => onAddEmailChange(event.target.value)}
                  placeholder="jane@example.com"
                  required
                  type="email"
                  value={addEmail}
                />
              </div>
              <div>
                <p className="mb-1.5 font-medium text-sm">Role</p>
                <OrgMemberRoleCards
                  onChange={onAddRoleChange}
                  value={addRole}
                />
              </div>
              {formError ? (
                <p className="text-destructive text-sm">{formError}</p>
              ) : null}
              <DialogFooter>
                <Button
                  onClick={() => onOpenChange(false)}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="mb-1.5 block font-medium text-sm"
                htmlFor="edit-name"
              >
                Name
              </label>
              <Input
                className="h-10 rounded-xl"
                id="edit-name"
                onChange={(event) => onEditNameChange(event.target.value)}
                placeholder="Jane Doe"
                value={editName}
              />
            </div>
            <div>
              <label
                className="mb-1.5 block font-medium text-sm"
                htmlFor="edit-phone"
              >
                Phone{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Input
                className="h-10 rounded-xl"
                id="edit-phone"
                onChange={(event) => onEditPhoneChange(event.target.value)}
                placeholder="+1234567890"
                value={editPhone}
              />
            </div>
          </div>
          <div>
            <label
              className="mb-1.5 block font-medium text-sm"
              htmlFor="edit-email"
            >
              Email
            </label>
            <Input
              className="h-10 rounded-xl"
              disabled
              id="edit-email"
              readOnly
              type="email"
              value={editingMember?.email ?? ""}
            />
          </div>
          <div>
            <p className="mb-1.5 font-medium text-sm">Role</p>
            <OrgMemberRoleCards onChange={onEditRoleChange} value={editRole} />
          </div>
          {formError ? (
            <p className="text-destructive text-sm">{formError}</p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
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
