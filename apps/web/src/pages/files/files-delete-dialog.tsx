import type { ArtifactFile } from "@nakama/core/contract";
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
import { Spinner } from "@nakama/ui/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useState } from "react";
import { client, formatError } from "@/lib/client";
import { artifactBasename } from "@/pages/files/files-artifact-folders";
import { FileRenameContext } from "@/pages/files/files-shared";

export function FilesDeleteDialog({
  deleteTarget,
  deletePending,
  onClose,
  onConfirm,
}: {
  deleteTarget: ArtifactFile | null;
  deletePending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      open={deleteTarget !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete artifact</DialogTitle>
          <DialogDescription>
            Remove {deleteTarget?.filename} from this profile?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={deletePending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {deletePending ? <Spinner className="size-4" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FilesRename({
  children,
  profileId,
  onRenamed,
}: {
  children: ReactNode;
  profileId: string | null;
  onRenamed: (oldPath: string, newPath: string) => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState(0);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, newName }: { path: string; newName: string }) =>
      client.renameProfileWorkspaceEntry(profileId!, { newName, path }),
    onSuccess: async (entry, variables) => {
      setTarget(null);
      onRenamed(variables.path, entry.path);
      // Discard open previews and selections that still point at the old path.
      setRevision((value) => value + 1);
      await queryClient.invalidateQueries({
        predicate: (query) =>
          [
            "workspace-files",
            "workspace-preview",
            "file-pins",
            "artifacts",
          ].includes(String(query.queryKey[0])),
      });
    },
  });
  function requestRename(path: string) {
    const normalized = path.replace(/\/$/, "");
    mutation.reset();
    setTarget(normalized);
    setName(artifactBasename(normalized));
  }
  return (
    <FileRenameContext.Provider value={profileId ? requestRename : null}>
      <Fragment key={revision}>{children}</Fragment>
      <Dialog
        onOpenChange={(open) => {
          if (!(open || mutation.isPending)) {
            setTarget(null);
          }
        }}
        open={target !== null}
      >
        <DialogContent showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (target && !mutation.isPending) {
                mutation.mutate({ newName: name, path: target });
              }
            }}
          >
            <Input
              aria-label="Name"
              disabled={mutation.isPending}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
              required
              value={name}
            />
            {mutation.error ? (
              <p className="text-destructive text-sm" role="alert">
                {formatError(mutation.error)}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={mutation.isPending}
                onClick={() => setTarget(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || mutation.isPending}
                type="submit"
              >
                {mutation.isPending ? <Spinner className="size-4" /> : null}
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </FileRenameContext.Provider>
  );
}
