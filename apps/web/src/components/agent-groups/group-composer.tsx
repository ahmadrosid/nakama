import type { ProfileSummary } from "@nakama/core";
import {
  ALL_MEMBERS_ID,
  mentionRanges,
  mentionSuggestions,
} from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { MAX_DOCUMENT_BYTES } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import {
  Add01Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  File01Icon,
  UserGroupIcon,
} from "hugeicons-react";
import { useEffect, useRef, useState } from "react";
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
  DOCUMENT_ACCEPT,
  filePartsToDocumentAttachments,
} from "@/lib/chat-images";
import {
  composerHitTargetClass,
  composerInputGroupClass,
} from "@/lib/chat-stream";

// The same textarea, send button and stop icon as the agent chat composer.
const FULL_TEXTAREA_CLASS =
  "max-h-36 min-h-9 px-1 py-1 text-base leading-relaxed [scrollbar-gutter:stable] placeholder:text-muted-foreground sm:min-h-8 sm:text-sm";

// One row: the field on the left, stop and send on the right.
const GROUP_SHELL_CLASS =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-row [&_[data-slot=input-group]]:items-center [&_[data-slot=input-group]]:gap-2 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:py-2 [&_[data-slot=input-group]]:pr-2 [&_[data-slot=input-group]]:pl-4 [&_[data-slot=input-group]]:shadow-xs [&_[data-slot=input-group]]:transition-[box-shadow,border-color]";

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
  /** Shows the attach button; a thread has none. */
  allowDocuments?: boolean;
  busy: boolean;
  handles: Map<string, string>;
  /** Text to start with, such as a message whose send failed. */
  initialInput?: string;
  members: ProfileSummary[];
  onSend: (content: string, documents?: DocumentAttachment[]) => Promise<void>;
  onStop: () => void;
  /** Shown in the empty field; the group wording by default. */
  placeholder?: string;
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
  allowDocuments = false,
  busy,
  handles,
  members,
  onSend,
  onStop,
  placeholder = "Message the group, @mention an agent or @all",
  stopping,
}: GroupComposerProps) {
  const { attachments, textInput } = usePromptInputController();
  const draft = textInput.value;
  const canSend = Boolean(draft.trim()) || attachments.files.length > 0;
  // Read when a send fails, after the user may have typed something new.
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  });

  const [caret, setCaret] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mention = findActiveSkillSlashRange(draft, caret, "@");

  // A thread is with one agent, so it has nobody to mention.
  const suggestions =
    mention && handles.size > 0
      ? mentionSuggestions(mention.query, handles)
      : [];

  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, suggestions.length - 1);
  const query = mention?.query;

  // A new query starts the list from its top again.
  useEffect(() => {
    setActive(0);
  }, [query]);

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
          {suggestions.map((handle, index) => {
            const id = mentionRanges(`@${handle}`, handles)[0]?.id;
            const member = members.find((m) => m.id === id);

            return (
              <button
                aria-selected={index === activeIndex}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted",
                  index === activeIndex && "bg-muted"
                )}
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
      {attachments.files.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.files.map((file) => (
            <div
              className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted py-1.5 pr-1.5 pl-3"
              key={file.id}
            >
              <File01Icon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="truncate font-medium text-xs">
                {file.filename ?? "Document"}
              </span>
              <button
                aria-label={`Remove ${file.filename ?? "document"}`}
                className="rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => attachments.remove(file.id)}
                type="button"
              >
                <Cancel01Icon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <PromptInput
        accept={allowDocuments ? DOCUMENT_ACCEPT : undefined}
        className={GROUP_SHELL_CLASS}
        inputGroupClassName={composerInputGroupClass}
        maxFileSize={allowDocuments ? MAX_DOCUMENT_BYTES : undefined}
        maxFiles={allowDocuments ? 5 : undefined}
        multiple={allowDocuments}
        onError={(attachmentError) => toast(attachmentError.message)}
        // Returning nothing lets PromptInput clear the field at once; a failed
        // send puts the text back unless something new was typed meanwhile.
        onSubmit={({ files, text }) => {
          const content = text.trim();
          const documents = filePartsToDocumentAttachments(files);

          if (!(content || documents.length > 0)) {
            return;
          }

          onSend(content, documents).catch(() => {
            if (!draftRef.current.trim()) {
              textInput.setInput(content);
            }
          });
        }}
      >
        <PromptInputBody>
          <div className="relative min-w-0 flex-1">
            <ChatSkillTokenOverlay
              className={FULL_TEXTAREA_CLASS}
              flat
              ranges={ranges}
              scrollTop={scrollTop}
              value={draft}
            />
            <PromptInputTextarea
              aria-label="Message"
              className={cn(
                FULL_TEXTAREA_CLASS,
                "text-transparent caret-foreground"
              )}
              maxLength={8000}
              onChange={(event) => setCaret(event.target.selectionStart)}
              onKeyDown={(event) => {
                const chosen = suggestions[activeIndex];

                if (!chosen) {
                  return;
                }

                if (event.key === "Tab" || event.key === "Enter") {
                  event.preventDefault();
                  insertMention(chosen);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((activeIndex + 1) % suggestions.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(
                    (activeIndex - 1 + suggestions.length) % suggestions.length
                  );
                }
              }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              placeholder={placeholder}
              ref={inputRef}
            />
          </div>
        </PromptInputBody>
        <PromptInputFooter className="w-auto shrink-0 flex-nowrap items-center justify-end gap-1.5 border-0 p-0">
          {allowDocuments ? (
            <Button
              aria-label="Add document"
              className="size-8 shrink-0 rounded-full"
              onClick={attachments.openFileDialog}
              size="icon-sm"
              title="Add document"
              type="button"
              variant="ghost"
            >
              <Add01Icon className="size-4" />
            </Button>
          ) : null}
          {/* One button at a time: Stop while agents reply, Send once you type. */}
          {busy && !canSend ? (
            <Button
              aria-label="Stop after this reply"
              className={composerSubmitButtonClassName}
              disabled={stopping}
              onClick={onStop}
              size="icon-sm"
              title="Stop after this reply"
              type="button"
            >
              <StopIcon />
            </Button>
          ) : (
            <PromptInputSubmit
              aria-label={busy ? "Add to the conversation" : "Send message"}
              className={composerSubmitButtonClassName}
              disabled={!canSend}
            >
              <ArrowUp02Icon className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
