import { buttonVariants } from "@nakama/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";

/**
 * The link is a plain anchor the operator clicks: a window.open fired after the
 * request that produced this URL is a popup blocker's favourite target, and a
 * blocked popup looks exactly like nothing happening.
 */
export function McpServerAuthorizeDialog({
  open,
  serverName,
  authorizationUrl,
  onOpenChange,
}: {
  open: boolean;
  serverName: string;
  authorizationUrl: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!authorizationUrl) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-3">
          <DialogTitle>Sign in to {serverName}</DialogTitle>
          <DialogDescription>
            {new URL(authorizationUrl).host} handles the sign-in. Approve
            Nakama's access there and this server connects on its own. Nothing
            is stored until you approve.
          </DialogDescription>
        </DialogHeader>

        <a
          className={cn(buttonVariants({ size: "default" }), "w-full")}
          href={authorizationUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open the sign-in page
        </a>

        <p className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Waiting for approval. This closes itself once connected.
        </p>

        <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-center">
          <button
            className="text-muted-foreground text-xs underline"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Finish later
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
