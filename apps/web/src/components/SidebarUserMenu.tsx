import { useState } from "react";
import { LogOutIcon, SparklesIcon, UserIcon } from "lucide-react";
import { THEME_OPTIONS } from "@/components/theme-options";
import { UserContextEditorDialog } from "@/components/UserContextCard";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { client, formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

export function SidebarUserMenu() {
  const { user, logout, refreshSession } = useAuth();
  const { theme, setTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [personalisationOpen, setPersonalisationOpen] = useState(false);

  if (!user) {
    return null;
  }

  const displayName = user.name?.trim() || user.email;
  const initial = (user.name?.trim()?.[0] ?? user.email[0] ?? "?").toUpperCase();

  const trigger = (
    <button
      type="button"
      aria-label="Account menu"
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-foreground"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-foreground">
        {initial}
      </span>
    </button>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <DropdownMenu>
                <DropdownMenuTrigger render={trigger} />
                <DropdownMenuContent
                  side="right"
                  align="end"
                  sideOffset={8}
                  className="w-64 gap-0 overflow-hidden p-0"
                >
                  <div className="space-y-0.5 px-3.5 py-3">
                    <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>

                  <div className="h-px bg-border" />

                  <div className="p-1">
                    <DropdownMenuItem
                      className="px-2.5 py-2"
                      onClick={() => {
                        setProfileOpen(true);
                      }}
                    >
                      <UserIcon className="size-4 text-muted-foreground" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="px-2.5 py-2"
                      onClick={() => {
                        setPersonalisationOpen(true);
                      }}
                    >
                      <SparklesIcon className="size-4 text-muted-foreground" />
                      Personalisation
                    </DropdownMenuItem>
                  </div>

                  <div className="h-px bg-border" />

                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-sm text-muted-foreground">Theme</span>
                    <div
                      className="flex rounded-md bg-muted/60 p-0.5"
                      role="group"
                      aria-label="Color theme"
                    >
                      {THEME_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const selected = theme === option.id;

                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-label={option.label}
                            aria-pressed={selected}
                            className={cn(
                              "rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground",
                              selected && "bg-background text-foreground shadow-sm",
                            )}
                            onClick={() => {
                              setTheme(option.id);
                            }}
                          >
                            <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  <div className="p-1">
                    <DropdownMenuItem
                      variant="destructive"
                      className="px-2.5 py-2"
                      onClick={() => {
                        void logout();
                      }}
                    >
                      <LogOutIcon className="size-4" />
                      Log out
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          }
        />
        <TooltipContent side="right" sideOffset={8}>
          {displayName}
        </TooltipContent>
      </Tooltip>

      <UserProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        email={user.email}
        name={user.name ?? ""}
        phone={user.phone ?? ""}
        onSaved={() => void refreshSession()}
      />

      <UserContextEditorDialog
        open={personalisationOpen}
        onOpenChange={setPersonalisationOpen}
        ensureExistsOnOpen
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
