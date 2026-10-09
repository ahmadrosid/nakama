import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import { BrainIcon } from "hugeicons-react";
import {
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input";
import { composerSelectTriggerClass } from "@/lib/chat-stream";
import { THINKING_EFFORT_OPTIONS } from "@/lib/thinking-settings";

const THINKING_TOOLTIP = "Reasoning depth for the next replies.";

function shortEffortLabel(effort: string, fullLabel: string): string {
  switch (effort) {
    case "high":
      return "High";
    case "low":
      return "Low";
    case "medium":
      return "Med";
    default:
      return fullLabel;
  }
}

export interface ChatThinkingEffortControlProps {
  disabled?: boolean;
  effort: string;
  onEffortChange: (effort: string) => void;
  /** Levels to offer. Defaults to low, medium, and high. */
  options?: Array<{ label: string; value: string }>;
  visible: boolean;
}

export function ChatThinkingEffortControl({
  visible,
  effort,
  disabled = false,
  onEffortChange,
  options = THINKING_EFFORT_OPTIONS,
}: ChatThinkingEffortControlProps) {
  if (!visible) {
    return null;
  }

  const fullLabel =
    options.find((option) => option.value === effort)?.label ?? effort;

  const shortLabel = shortEffortLabel(effort, fullLabel);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="inline-flex">
            <PromptInputSelect
              disabled={disabled}
              onValueChange={(value) => onEffortChange(value)}
              value={effort}
            >
              <PromptInputSelectTrigger
                aria-label="Thinking effort"
                className={cn(composerSelectTriggerClass, "shrink-0")}
                size="sm"
                title={THINKING_TOOLTIP}
              >
                <PromptInputSelectValue placeholder="Thinking">
                  <span className="inline-flex items-center gap-1">
                    <BrainIcon
                      aria-hidden
                      className="size-3 shrink-0 opacity-70"
                    />
                    <span className="@[22rem]/composer:hidden">
                      {shortLabel}
                    </span>
                    <span className="@[22rem]/composer:inline hidden">
                      {fullLabel}
                    </span>
                  </span>
                </PromptInputSelectValue>
              </PromptInputSelectTrigger>
              <PromptInputSelectContent
                align="start"
                alignItemWithTrigger={false}
                className="w-max min-w-[8rem] text-xs"
              >
                {options.map((option) => (
                  <PromptInputSelectItem
                    key={option.value}
                    label={option.label}
                    value={option.value}
                  >
                    {option.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </div>
        }
      />
      <TooltipContent className="max-w-xs" side="top">
        {THINKING_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}
