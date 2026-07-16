import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OrgMemberRoleSelect } from "@/components/settings/org-member-role-select";

export function OrgMemberInviteDialog({
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
        </DialogHeader>
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
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  onOpenChange,
  onAddNameChange,
  onAddEmailChange,
  onAddPhoneChange,
  onAddRoleChange,
  onSubmit,
}: {
  open: boolean;
  addName: string;
  addEmail: string;
  addPhone: string;
  addRole: OrgRole;
  formError: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onAddNameChange: (value: string) => void;
  onAddEmailChange: (value: string) => void;
  onAddPhoneChange: (value: string) => void;
  onAddRoleChange: (role: OrgRole) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
              Phone
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
