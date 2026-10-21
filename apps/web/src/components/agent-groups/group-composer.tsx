import type { ProfileSummary } from "@nakama/core";
import {
  ALL_MEMBERS_ID,
  mentionRanges,
  mentionSuggestions,
} from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { MAX_DOCUMENT_BYTES, parseDataUrl } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import {
  Add01Icon,
  ArrowDown01Icon,
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
  ALL_ATTACHMENT_ACCEPT,
  filePartsToDocumentAttachments,
  isImageFilePart,
} from "@/lib/chat-images";
import {
  composerHitTargetClass,
  composerInputGroupClass,
} from "@/lib/chat-stream";
import {
  isPastedTextDocument,
  LONG_PASTE_WORD_THRESHOLD,
  wordCountFromPastedFilename,
} from "@/lib/pasted-text";

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
  /** Shows the attach button and takes pasted images and documents. */
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
      <GroupAttachmentSummary />
      <PromptInput
        accept={allowDocuments ? ALL_ATTACHMENT_ACCEPT : undefined}
        className={cn(
          GROUP_SHELL_CLASS,
          attachments.files.length > 0 &&
            "[&_[data-slot=input-group]]:rounded-t-none"
        )}
        inputGroupClassName={composerInputGroupClass}
        maxFileSize={allowDocuments ? MAX_DOCUMENT_BYTES : undefined}
        maxFiles={allowDocuments ? 5 : undefined}
        multiple={allowDocuments}
        onError={(attachmentError) => toast(attachmentError.message)}
        // Returning nothing lets PromptInput clear the field at once; a failed
        // send puts the text back unless something new was typed meanwhile.
        onSubmit={({ files, text }) => {
          const content = text.trim();

          // Images go with the documents; the server saves them for the agents.
          const documents = [
            ...filePartsToDocumentAttachments(files),
            ...files.filter(isImageFilePart).flatMap((file) => {
              const image = parseDataUrl(file.url);

              return image
                ? [{ ...image, filename: file.filename ?? "image.png" }]
                : [];
            }),
          ];

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
              longPasteWordThreshold={
                allowDocuments ? LONG_PASTE_WORD_THRESHOLD : undefined
              }
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
              aria-label="Add file"
              className="size-8 shrink-0 rounded-full"
              onClick={attachments.openFileDialog}
              size="icon-sm"
              title="Add file"
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

/** The attached files as one line on top of the field; the list opens on demand. */
function GroupAttachmentSummary() {
  const { attachments } = usePromptInputController();
  const [filesOpen, setFilesOpen] = useState(false);

  const files = attachments.files.map((file) => {
    const filename = file.filename ?? "Document";

    const words = isPastedTextDocument(filename, file.mediaType ?? "")
      ? wordCountFromPastedFilename(filename)
      : null;

    return {
      filename,
      id: file.id,
      label:
        words === null
          ? filename
          : `Pasted text, ${words.toLocaleString()} words`,
      words,
    };
  });

  const pastedWords = files.every((file) => file.words !== null)
    ? files.reduce((total, file) => total + (file.words ?? 0), 0)
    : null;

  const summary =
    files.length === 1
      ? files[0]!.label
      : pastedWords === null
        ? `${files.length} attachments`
        : `${files.length} pasted texts · ${pastedWords.toLocaleString()} words`;

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="rounded-t-xl border border-border border-b-0 bg-muted/50 text-foreground/80 text-xs">
      <div className="flex items-center gap-2 py-1 pr-1.5 pl-4">
        <File01Icon aria-hidden className="size-3.5 shrink-0" />
        {files.length > 1 ? (
          <button
            aria-expanded={filesOpen}
            className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
            onClick={() => setFilesOpen(!filesOpen)}
            type="button"
          >
            <span className="flex-1 truncate font-medium">{summary}</span>
            <span className="text-muted-foreground">
              {filesOpen ? "Hide" : "Show"}
            </span>
            <ArrowDown01Icon
              aria-hidden
              className={cn("size-3.5", filesOpen && "rotate-180")}
            />
          </button>
        ) : (
          <>
            <span className="flex-1 truncate py-1 font-medium">{summary}</span>
            <button
              aria-label={`Remove ${files[0]!.filename}`}
              className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => attachments.remove(files[0]!.id)}
              type="button"
            >
              <Cancel01Icon className="size-3.5" />
            </button>
          </>
        )}
      </div>
      {files.length > 1 && filesOpen ? (
        <ul className="max-h-28 overflow-y-auto border-border/60 border-t pb-1">
          {files.map((file, index) => (
            <li
              className="flex items-center gap-2 py-0.5 pr-1.5 pl-[2.375rem]"
              key={file.id}
            >
              <span className="flex-1 truncate">
                {index + 1}. {file.label}
              </span>
              <button
                aria-label={`Remove ${file.filename}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => attachments.remove(file.id)}
                type="button"
              >
                <Cancel01Icon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
