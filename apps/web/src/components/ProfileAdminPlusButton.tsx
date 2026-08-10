import { Add01Icon } from "hugeicons-react";
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
            aria-label={label}
            className="text-muted-foreground/70 hover:text-foreground"
            disabled={disabled}
            onClick={onClick}
            size="icon-sm"
            title={label}
            type="button"
            variant="ghost"
          >
            <Add01Icon aria-hidden className="size-4" />
          </Button>
        }
      />
      <TooltipContent side={tooltipSide} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
