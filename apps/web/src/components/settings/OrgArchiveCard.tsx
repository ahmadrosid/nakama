import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { useState } from "react";
import { useAuth } from "@/context/use-auth";
import { formatError } from "@/lib/client";
import { canArchiveOrganization } from "@/lib/org-archive";

export function OrgArchiveCard() {
  const { user, activeOrg, archiveOrg } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!(canArchiveOrganization(user?.isPlatformAdmin === true) && activeOrg)) {
    return null;
  }

  const org = activeOrg;
  const orgName = org.name;

  async function handleArchive() {
    setPending(true);
    setFormError(null);
    try {
      await archiveOrg(org.id);
      setConfirmOpen(false);
    } catch (error) {
      setFormError(formatError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <h2 className="font-medium text-sm">Delete organization</h2>
        <Button
          onClick={() => {
            setFormError(null);
            setConfirmOpen(true);
          }}
          type="button"
          variant="destructive"
        >
          Delete
        </Button>
      </div>
      <Dialog
        onOpenChange={(open) => {
          if (!(open || pending)) {
            setConfirmOpen(false);
          }
        }}
        open={confirmOpen}
      >
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <DialogHeader className="gap-3">
            <DialogTitle>Delete organization?</DialogTitle>
            <DialogDescription>
              {orgName} will disappear from the switcher and chat. Members,
              profiles, and files stay on disk. Nakama cannot restore it.
            </DialogDescription>
          </DialogHeader>
          {formError ? (
            <p className="text-destructive text-sm" role="alert">
              {formError}
            </p>
          ) : null}
          <DialogFooter className="mx-0 mb-0 gap-2 border-0 bg-transparent p-0 sm:flex-row sm:justify-end">
            <Button
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                void handleArchive();
              }}
              type="button"
              variant="destructive"
            >
              {pending ? <Spinner className="size-4" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
