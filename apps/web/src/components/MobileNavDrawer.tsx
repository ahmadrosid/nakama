import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Menu01Icon } from "hugeicons-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { ProfileRail } from "@/components/ProfileRail";
import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Phone-sized navigation. The rail and sidebar cost a fixed 296px, which is
 * most of a phone screen, so below `sm` they slide over the content instead of
 * sitting beside it.
 */
export function MobileNavDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Any navigation dismisses the drawer, including ones triggered from menus
  // and popovers inside it.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  // The trigger disappears at sm, but an open drawer would stay mounted over
  // the desktop sidebar after a rotation or a window resize.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const closeAboveSm = () => {
      if (desktop.matches) {
        setOpen(false);
      }
    };

    closeAboveSm();
    desktop.addEventListener("change", closeAboveSm);
    return () => desktop.removeEventListener("change", closeAboveSm);
  }, []);

  const close = () => setOpen(false);

  return (
    <DialogPrimitive.Root onOpenChange={setOpen} open={open}>
      <DialogPrimitive.Trigger
        render={
          <Button
            aria-label="Open navigation"
            className={cn("shrink-0 text-muted-foreground", className)}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <Menu01Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogOverlay className="bg-black/40" />
        <DialogPrimitive.Popup
          className="data-open:slide-in-from-left data-closed:slide-out-to-left fixed inset-y-0 left-0 z-50 flex w-[18.5rem] max-w-[85vw] bg-background pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] outline-none duration-150 data-closed:animate-out data-open:animate-in"
          data-slot="mobile-nav-drawer"
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <ProfileRail onNavigate={close} />
          <AppSidebar variant="drawer" />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
