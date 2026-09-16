import { Button } from "@nakama/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import { IncognitoIcon } from "hugeicons-react";

export function ChatCognitoControl({
  cognito,
  disabled = false,
  onCognitoChange,
}: {
  cognito: boolean;
  disabled?: boolean;
  onCognitoChange: (cognito: boolean) => void;
}) {
  return (
    <div
      aria-label="Cognito mode"
      className="flex items-center gap-1.5"
      role="group"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={cognito ? "Turn off cognito" : "Turn on cognito"}
              aria-pressed={cognito}
              className={cn(
                // Off it still needs a visible target, so it keeps a muted
                // disc instead of disappearing into the background the way a
                // bare ghost button does.
                "size-8 rounded-full transition-colors",
                cognito
                  ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              disabled={disabled}
              id="chat-cognito-toggle"
              onClick={() => onCognitoChange(!cognito)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <IncognitoIcon className="size-4" />
            </Button>
          }
        />
        <TooltipContent side="bottom">
          {cognito
            ? "Cognito is on. This chat is not saved and never written to memory."
            : "Cognito: a chat that is not saved and never written to memory"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
