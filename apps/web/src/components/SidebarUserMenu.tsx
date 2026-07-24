import { useState } from "react";
import { LogOutIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { client, formatError } from "@/lib/client";

export function SidebarUserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, logout, refreshSession } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  if (!user) {
    return null;
  }

  const displayName = user.name?.trim() || user.email;
  const initial = (user.name?.trim()?.[0] ?? user.email[0] ?? "?").toUpperCase();

  const trigger = collapsed ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Account menu"
      className="shrink-0 text-muted-foreground/70 hover:text-foreground"
    >
      <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
        {initial}
      </span>
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      aria-label="Account menu"
      className="h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5 text-left text-muted-foreground hover:text-foreground"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{displayName}</span>
    </Button>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "start"}
          sideOffset={8}
          className="w-56"
        >
          <div className="px-1.5 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <DropdownMenuItem
            onClick={() => {
              setProfileOpen(true);
            }}
          >
            <UserIcon className="size-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              void logout();
            }}
          >
            <LogOutIcon className="size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        email={user.email}
        name={user.name ?? ""}
        phone={user.phone ?? ""}
        onSaved={() => void refreshSession()}
      />
    </>
  );
}

function UserProfileDialog({
  open,
  onOpenChange,
  email,
  name,
  phone,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  name: string;
  phone: string;
  onSaved: () => void;
}) {
  const [formName, setFormName] = useState(name);
  const [formEmail, setFormEmail] = useState(email);
  const [formPhone, setFormPhone] = useState(phone);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setFormName(name);
      setFormEmail(email);
      setFormPhone(phone);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = formEmail.trim();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }

    const wantsPasswordChange = Boolean(
      currentPassword || newPassword || confirmPassword,
    );
    if (wantsPasswordChange) {
      if (!currentPassword || !newPassword) {
        setError("Enter your current password and a new password.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New password and confirmation do not match.");
        return;
      }
    }

    setPending(true);
    try {
      await client.updateAuthProfile({
        name: formName,
        email: trimmedEmail,
        phone: formPhone,
      });

      if (wantsPasswordChange) {
        await client.changePassword({
          currentPassword,
          newPassword,
        });
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>Update your name, email, phone, or password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <Input
              id="profile-name"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              placeholder="Your name"
            />
          </div>
          <div>
            <label htmlFor="profile-email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <Input
              id="profile-email"
              type="email"
              value={formEmail}
              onChange={(event) => setFormEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="profile-phone" className="mb-1 block text-sm font-medium">
              Phone{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="profile-phone"
              value={formPhone}
              onChange={(event) => setFormPhone(event.target.value)}
              placeholder="+1234567890"
            />
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium">Password</p>
              <p className="text-xs text-muted-foreground">Leave blank to keep your current one.</p>
            </div>
            <div>
              <label htmlFor="profile-current-password" className="mb-1 block text-sm font-medium">
                Current
              </label>
              <Input
                id="profile-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label htmlFor="profile-new-password" className="mb-1 block text-sm font-medium">
                New
              </label>
              <Input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label htmlFor="profile-confirm-password" className="mb-1 block text-sm font-medium">
                Confirm
              </label>
              <Input
                id="profile-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
