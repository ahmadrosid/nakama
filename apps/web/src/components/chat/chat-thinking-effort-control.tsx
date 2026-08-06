import type { ThinkingEffort } from "@nakama/core/contract";
import { BrainIcon } from "lucide-react";
import {
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { composerSelectTriggerClass } from "@/lib/chat-stream";
import {
  THINKING_EFFORT_OPTIONS,
  thinkingEffortLabel,
} from "@/lib/thinking-settings";
import { cn } from "@/lib/utils";

const THINKING_TOOLTIP = "Reasoning depth for the next replies.";

export interface ChatThinkingEffortControlProps {
  visible: boolean;
  effort: ThinkingEffort;
  disabled?: boolean;
  onEffortChange: (effort: ThinkingEffort) => void;
}

export function ChatThinkingEffortControl({
  visible,
  effort,
  disabled = false,
  onEffortChange,
}: ChatThinkingEffortControlProps) {
  if (!visible) {
    return null;
  }

  const fullLabel = thinkingEffortLabel(effort);
  const shortLabel = ({ low: "Low", medium: "Med", high: "High" } as const)[effort];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="inline-flex">
            <PromptInputSelect
              value={effort}
              disabled={disabled}
              onValueChange={(value) => {
                if (value === "low" || value === "medium" || value === "high") {
                  onEffortChange(value);
                }
              }}
            >
              <PromptInputSelectTrigger
                size="sm"
                className={cn(composerSelectTriggerClass, "shrink-0")}
                aria-label="Thinking effort"
                title={THINKING_TOOLTIP}
              >
                <PromptInputSelectValue placeholder="Thinking">
                  <span className="inline-flex items-center gap-1">
                    <BrainIcon className="size-3 shrink-0 opacity-70" aria-hidden />
                    <span className="@[22rem]/composer:hidden">{shortLabel}</span>
                    <span className="hidden @[22rem]/composer:inline">{fullLabel}</span>
                  </span>
                </PromptInputSelectValue>
              </PromptInputSelectTrigger>
              <PromptInputSelectContent
                align="start"
                alignItemWithTrigger={false}
                className="w-max min-w-[8rem] text-xs"
              >
                {THINKING_EFFORT_OPTIONS.map((option) => (
                  <PromptInputSelectItem
                    key={option.value}
                    value={option.value}
                    label={option.label}
                  >
                    {option.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </div>
        }
      />
      <TooltipContent side="top" className="max-w-xs">
        {THINKING_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}
