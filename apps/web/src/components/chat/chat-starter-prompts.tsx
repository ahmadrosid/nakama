import { Button } from "@nakama/ui/button";
import { usePromptInputController } from "@/components/ai-elements/prompt-input-context";

export const STARTER_PROMPTS = [
  "What can you help me with?",
  "Draft a polite reply to a customer who asked about our prices",
  "Make a checklist for my tasks this week",
];

/**
 * A first chat starts from a blank box, the hardest prompt for someone who
 * does not know yet what the agent is for. A click fills the composer and
 * sends nothing, so the user can still edit it.
 */
export function ChatStarterPrompts() {
  const { textInput } = usePromptInputController();

  if (textInput.value) {
    return null;
  }

  return (
    <div
      aria-label="Starter prompts"
      className="flex flex-wrap gap-2 px-4 pt-2"
      role="group"
    >
      {STARTER_PROMPTS.map((prompt) => (
        <Button
          className="h-auto whitespace-normal text-left"
          key={prompt}
          onClick={() => textInput.setInput(prompt)}
          size="sm"
          type="button"
          variant="outline"
        >
          {prompt}
        </Button>
      ))}
    </div>
  );
}
