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
  disabled?: boolean;
  effort: ThinkingEffort;
  onEffortChange: (effort: ThinkingEffort) => void;
  visible: boolean;
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
  const shortLabel = ({ high: "High", low: "Low", medium: "Med" } as const)[
    effort
  ];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="inline-flex">
            <PromptInputSelect
              disabled={disabled}
              onValueChange={(value) => {
                if (value === "low" || value === "medium" || value === "high") {
                  onEffortChange(value);
                }
              }}
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
                {THINKING_EFFORT_OPTIONS.map((option) => (
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
