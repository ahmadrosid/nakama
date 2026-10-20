import type { ProfileSummary } from "@nakama/core";
import {
  ALL_MEMBERS_ID,
  mentionRanges,
  mentionSuggestions,
} from "@nakama/core/agent-groups";
import { Button } from "@nakama/ui/button";
import { cn } from "@nakama/ui/utils";
import { ArrowUp02Icon, UserGroupIcon } from "hugeicons-react";
import { useRef, useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { ChatSkillTokenOverlay } from "@/components/chat/chat-skill-token-overlay";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { findActiveSkillSlashRange } from "@/lib/chat-composer-skills";
import {
  composerHitTargetClass,
  composerInputGroupClass,
  composerShellClass,
} from "@/lib/chat-stream";

// The same textarea, send button and stop icon as the agent chat composer.
const FULL_TEXTAREA_CLASS =
  "max-h-36 min-h-9 px-1 py-1 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-8 sm:text-sm";

const composerSubmitButtonClassName = cn(
  composerHitTargetClass,
  "size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-[color,background-color,transform,opacity] hover:bg-primary/90 active:scale-[0.96] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
);

function StopIcon() {
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-[3px] bg-current"
    />
  );
}

interface GroupComposerProps {
  busy: boolean;
  handles: Map<string, string>;
  /** Text to start with, such as a message whose send failed. */
  initialInput?: string;
  members: ProfileSummary[];
  onSend: (content: string) => Promise<void>;
  onStop: () => void;
  stopping: boolean;
}

/**
 * The agent chat composer, with @member autocomplete. It stays usable while
 * agents reply: a new message joins the running turn.
 */
export function GroupComposer(props: GroupComposerProps) {
  return (
    <PromptInputProvider initialInput={props.initialInput}>
      <GroupComposerForm {...props} />
    </PromptInputProvider>
  );
}

function GroupComposerForm({
  busy,
  handles,
  members,
  onSend,
  onStop,
  stopping,
}: GroupComposerProps) {
  const { textInput } = usePromptInputController();
  const draft = textInput.value;
  // Read when a send fails, after the user may have typed something new.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [caret, setCaret] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mention = findActiveSkillSlashRange(draft, caret, "@");
  const suggestions = mention ? mentionSuggestions(mention.query, handles) : [];

  const ranges = mentionRanges(draft, handles).map(
    ({ end, handle, start }) => ({ end, name: handle, start })
  );

  function insertMention(handle: string) {
    if (!mention) {
      return;
    }

    const position = mention.start + handle.length + 2;
    textInput.setInput(
      `${draft.slice(0, mention.start)}@${handle} ${draft.slice(mention.end)}`
    );
    setCaret(position);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  }

  return (
    <div className="relative" id="agent-group-composer">
      {suggestions.length > 0 ? (
        <div
          className="absolute bottom-full left-0 z-20 mb-2 flex min-w-56 flex-col rounded-xl border border-border bg-popover p-1 shadow-md"
          role="listbox"
        >
          {suggestions.map((handle) => {
            const id = mentionRanges(`@${handle}`, handles)[0]?.id;
            const member = members.find((m) => m.id === id);

            return (
              <button
                aria-selected={false}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                key={handle}
                onClick={() => insertMention(handle)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                {id === ALL_MEMBERS_ID ? (
                  <UserGroupIcon aria-hidden className="size-5 p-0.5" />
                ) : member ? (
                  <ProfileAvatar profile={member} size="xs" />
                ) : null}
                <span className="font-medium">
                  {id === ALL_MEMBERS_ID
                    ? "Everyone"
                    : (member?.name ?? handle)}
                </span>
                <span className="truncate text-muted-foreground">
                  @{handle}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <PromptInput
        className={composerShellClass}
        inputGroupClassName={composerInputGroupClass}
        // Returning nothing lets PromptInput clear the field at once; a failed
        // send puts the text back unless something new was typed meanwhile.
        onSubmit={({ text }) => {
          const content = text.trim();

          onSend(content).catch(() => {
            if (!draftRef.current.trim()) {
              textInput.setInput(content);
            }
          });
        }}
        rimActive={busy}
      >
        <PromptInputBody>
          <div className="relative min-w-0 flex-1">
            <ChatSkillTokenOverlay
              className={FULL_TEXTAREA_CLASS}
              ranges={ranges}
              scrollTop={scrollTop}
              value={draft}
            />
            <PromptInputTextarea
              aria-label="Message"
              className={FULL_TEXTAREA_CLASS}
              maxLength={8000}
              onChange={(event) => setCaret(event.target.selectionStart)}
              onKeyDown={(event) => {
                const [first] = suggestions;

                if (first && (event.key === "Tab" || event.key === "Enter")) {
                  event.preventDefault();
                  insertMention(first);
                }
              }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              placeholder="Message the group, @mention an agent or @all"
              ref={inputRef}
            />
          </div>
        </PromptInputBody>
        <PromptInputFooter className="w-full flex-nowrap items-center justify-end gap-1.5 border-0 px-0 py-0 pt-1">
          {busy ? (
            <Button
              aria-label="Stop after this reply"
              className={composerSubmitButtonClassName}
              disabled={stopping}
              onClick={onStop}
              size="icon-sm"
              title="Stop after this reply"
              type="button"
              variant={draft.trim() ? "outline" : "default"}
            >
              <StopIcon />
            </Button>
          ) : null}
          <PromptInputSubmit
            aria-label={busy ? "Add to the conversation" : "Send message"}
            className={composerSubmitButtonClassName}
            disabled={!draft.trim()}
          >
            <ArrowUp02Icon className="size-4" />
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
