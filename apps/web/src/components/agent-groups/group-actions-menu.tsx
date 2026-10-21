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
import { withPanel } from "@/lib/agent-group-pending";

/** Edit group, and the group's shared folder or memory in the side panel, behind one menu. */
export function GroupActionsMenu({ onEdit }: { onEdit: () => void }) {
  const [, setSearchParams] = useSearchParams();

  const openPanel = (panel: "files" | "memory") =>
    setSearchParams((current) => withPanel(current, panel, "1"), {
      replace: true,
    });

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
