import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { activeOrg } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => client.createProject(name.trim()),
    onSuccess: async ({ workspace }) => {
      await queryClient.invalidateQueries({
        queryKey: ["chatWorkspaces", activeOrg?.id],
      });
      onClose();
      navigate(`/projects/${workspace.id}`);
    },
  });
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || create.isPending)) {
          onClose();
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) {
              create.mutate();
            }
          }}
        >
          <Input
            aria-label="Project name"
            disabled={create.isPending}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            required
            value={name}
          />
          {create.error && (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {formatError(create.error)}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button
              disabled={create.isPending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={create.isPending || !name.trim()} type="submit">
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
