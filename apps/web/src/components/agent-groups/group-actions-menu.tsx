import { Button } from "@nakama/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import {
  BrainIcon,
  Folder01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from "hugeicons-react";
import { useSearchParams } from "react-router-dom";
import { PANELS } from "@/lib/agent-group-pending";

/** Edit group, and the group's shared folder or memory in the side panel, behind one menu. */
export function GroupActionsMenu({ onEdit }: { onEdit: () => void }) {
  const [, setSearchParams] = useSearchParams();

  const openPanel = (panel: "files" | "memory") =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);

        for (const key of PANELS) {
          next.delete(key);
        }

        next.set(panel, "1");

        return next;
      },
      { replace: true }
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Group actions"
            size="icon-sm"
            type="button"
            variant="outline"
          />
        }
      >
        <MoreHorizontalIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <PencilEdit02Icon aria-hidden />
          Edit group
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel("files")}>
          <Folder01Icon aria-hidden />
          Files
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel("memory")}>
          <BrainIcon aria-hidden />
          Memory
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
