import { Logout03Icon, SparklesIcon, UserIcon } from "hugeicons-react";
import { useState } from "react";
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
  const initial = (
    user.name?.trim()?.[0] ??
    user.email[0] ??
    "?"
  ).toUpperCase();

  const trigger = (
    <button
      aria-label="Account menu"
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-foreground"
      type="button"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-muted font-semibold text-2xs text-foreground">
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
                  align="end"
                  className="w-64 gap-0 overflow-hidden p-0"
                  side="right"
                  sideOffset={8}
                >
                  <div className="space-y-0.5 px-3.5 py-3">
                    <p className="truncate font-semibold text-foreground text-sm">
                      {displayName}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {user.email}
                    </p>
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
                    <span className="text-muted-foreground text-sm">Theme</span>
                    <div
                      aria-label="Color theme"
                      className="flex rounded-md bg-muted/60 p-0.5"
                      role="group"
                    >
                      {THEME_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const selected = theme === option.id;

                        return (
                          <button
                            aria-label={option.label}
                            aria-pressed={selected}
                            className={cn(
                              "rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground",
                              selected &&
                                "bg-background text-foreground shadow-sm"
                            )}
                            key={option.id}
                            onClick={() => {
                              setTheme(option.id);
                            }}
                            type="button"
                          >
                            <Icon
                              aria-hidden="true"
                              className="size-3.5"
                              strokeWidth={1.75}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  <div className="p-1">
                    <DropdownMenuItem
                      className="px-2.5 py-2"
                      onClick={() => {
                        void logout();
                      }}
                      variant="destructive"
                    >
                      <Logout03Icon className="size-4" />
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
        email={user.email}
        name={user.name ?? ""}
        onOpenChange={setProfileOpen}
        onSaved={({ passwordChanged }) => {
          if (passwordChanged) {
            // Server revoked all sessions and cleared cookies; drop local auth
            // so AuthGuard sends the user to login with the new password.
            void logout();
            return;
          }
          void refreshSession();
        }}
        open={profileOpen}
        phone={user.phone ?? ""}
      />

      <UserContextEditorDialog
        ensureExistsOnOpen
        onOpenChange={setPersonalisationOpen}
        open={personalisationOpen}
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
  onSaved: (result: { passwordChanged: boolean }) => void;
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
      currentPassword || newPassword || confirmPassword
    );
    if (wantsPasswordChange) {
      if (!(currentPassword && newPassword)) {
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
        email: trimmedEmail,
        name: formName,
        phone: formPhone,
      });

      if (wantsPasswordChange) {
        await client.changePassword({
          currentPassword,
          newPassword,
        });
        onOpenChange(false);
        onSaved({ passwordChanged: true });
        return;
      }

      onSaved({ passwordChanged: false });
      onOpenChange(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>
            Update your name, email, phone, or password.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="profile-name"
            >
              Name
            </label>
            <Input
              id="profile-name"
              onChange={(event) => setFormName(event.target.value)}
              placeholder="Your name"
              value={formName}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="profile-email"
            >
              Email
            </label>
            <Input
              id="profile-email"
              onChange={(event) => setFormEmail(event.target.value)}
              required
              type="email"
              value={formEmail}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-medium text-sm"
              htmlFor="profile-phone"
            >
              Phone{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Input
              id="profile-phone"
              onChange={(event) => setFormPhone(event.target.value)}
              placeholder="+1234567890"
              value={formPhone}
            />
          </div>

          <div className="space-y-3 border-border border-t pt-4">
            <div>
              <p className="font-medium text-sm">Password</p>
              <p className="text-muted-foreground text-xs">
                Leave blank to keep your current one.
              </p>
            </div>
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="profile-current-password"
              >
                Current
              </label>
              <Input
                autoComplete="current-password"
                id="profile-current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="••••••••"
                type="password"
                value={currentPassword}
              />
            </div>
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="profile-new-password"
              >
                New
              </label>
              <Input
                autoComplete="new-password"
                id="profile-new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="••••••••"
                type="password"
                value={newPassword}
              />
            </div>
            <div>
              <label
                className="mb-1 block font-medium text-sm"
                htmlFor="profile-confirm-password"
              >
                Confirm
              </label>
              <Input
                autoComplete="new-password"
                id="profile-confirm-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="••••••••"
                type="password"
                value={confirmPassword}
              />
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

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
