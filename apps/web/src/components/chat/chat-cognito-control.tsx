import type { CognitoOptions } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import { IncognitoIcon } from "hugeicons-react";

const PERSONALIZED = "personalized";
const NOT_PERSONALIZED = "not-personalized";

export function ChatCognitoControl({
  cognito,
  disabled = false,
  locked = false,
  onCognitoChange,
}: {
  cognito: CognitoOptions | null;
  disabled?: boolean;
  /** True once the first message is sent: the sub-mode decides the prompt. */
  locked?: boolean;
  onCognitoChange: (cognito: CognitoOptions | null) => void;
}) {
  const active = cognito !== null;

  return (
    <div
      aria-label="Cognito mode"
      className="flex items-center gap-1.5"
      id="chat-cognito-control"
      role="group"
    >
      {active ? (
        <Select
          disabled={disabled || locked}
          onValueChange={(value) =>
            onCognitoChange({ personalized: value === PERSONALIZED })
          }
          value={cognito.personalized ? PERSONALIZED : NOT_PERSONALIZED}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <SelectTrigger
                  className="h-7 max-w-[13rem] border-dashed bg-background/80 text-xs"
                  id="chat-cognito-mode-select"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
              }
            />
            <TooltipContent side="bottom">
              {locked
                ? "Start a new cognito chat to change this"
                : "What this chat is allowed to use"}
            </TooltipContent>
          </Tooltip>
          <SelectContent align="end" className="max-w-[min(22rem,90vw)]">
            <SelectItem value={PERSONALIZED}>
              <span className="flex flex-col gap-0.5 text-left">
                <span className="font-medium">Personalized</span>
                <span className="text-muted-foreground text-xs">
                  Uses memory, plugins, skills and this agent's own
                  instructions.
                </span>
              </span>
            </SelectItem>
            <SelectItem value={NOT_PERSONALIZED}>
              <span className="flex flex-col gap-0.5 text-left">
                <span className="font-medium">Not personalized</span>
                <span className="text-muted-foreground text-xs">
                  Uses none of them. Just the model.
                </span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={active ? "Turn off cognito" : "Turn on cognito"}
              aria-pressed={active}
              className={cn(
                "size-8 rounded-full",
                active &&
                  "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
              )}
              disabled={disabled}
              id="chat-cognito-toggle"
              onClick={() =>
                onCognitoChange(active ? null : { personalized: true })
              }
              size="icon-sm"
              type="button"
              variant={active ? "default" : "ghost"}
            >
              <IncognitoIcon className="size-4" />
            </Button>
          }
        />
        <TooltipContent side="bottom">
          {active
            ? "Cognito is on. This chat is not saved and never written to memory."
            : "Cognito: a chat that is not saved and never written to memory"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
