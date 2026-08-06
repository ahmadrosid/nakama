import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ProfileAdminPlusButton({
  label,
  disabled,
  onClick,
  tooltipSide = "right",
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  tooltipSide?: "top" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={label}
            title={label}
            onClick={onClick}
            className="text-muted-foreground/70 hover:text-foreground"
          >
            <PlusIcon className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        }
      />
      <TooltipContent side={tooltipSide} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
