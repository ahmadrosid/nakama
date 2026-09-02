import { hasActiveAgentQuestionnaire } from "@nakama/core/agent-questionnaire";
import { hasActiveAgentTodos } from "@nakama/core/agent-todo";
import type {
  AgentQuestionAnswer,
  AgentQuestionnaire,
  AgentTodo,
  ProviderModelOption,
  SkillSummary,
  ThinkingEffort,
} from "@nakama/core/contract";
import { MAX_IMAGE_BYTES } from "@nakama/core/message-content";
import {
  Add01Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  File01Icon,
  Image01Icon,
  WifiOff01Icon,
} from "hugeicons-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { AgentQuestionnairePanel } from "@/components/chat/AgentQuestionnairePanel";
import { AgentTodoPanel } from "@/components/chat/AgentTodoPanel";
import {
  ChatMessageQueuePanel,
  type QueuedComposerMessage,
} from "@/components/chat/ChatMessageQueuePanel";
import { composerActions } from "@/components/chat/chat-composer-actions";
import { ChatContextUsageRing } from "@/components/chat/chat-context-usage";
import { ChatSkillPicker } from "@/components/chat/chat-skill-picker";
import { ChatSkillTokenOverlay } from "@/components/chat/chat-skill-token-overlay";
import { ChatThinkingEffortControl } from "@/components/chat/chat-thinking-effort-control";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatStatus, FileUIPart } from "@/lib/ai-ui-types";
import {
  type ComposerSlashSuggestion,
  filterComposerSlashSuggestions,
  findActiveSkillSlashRange,
  replaceSlashRangeWithReservedCommand,
  replaceSlashRangeWithSkillInvocation,
  type SkillSlashRange,
} from "@/lib/chat-composer-skills";
import type { ChatContextUsage } from "@/lib/chat-context-usage";
import {
  ALL_ATTACHMENT_ACCEPT,
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  isImageFilePart,
} from "@/lib/chat-images";
import {
  type ComposerStackEdge,
  composerHitTargetClass,
  composerIconButtonClass,
  composerInputGroupClass,
  composerSelectTriggerClass,
  composerShellClass,
  composerShellCompactClass,
  composerToolbarClass,
} from "@/lib/chat-stream";
import { prepareChatUploadFiles } from "@/lib/compress-image";
import { encodeModelSelection } from "@/lib/models";
import {
  isPastedTextDocument,
  LONG_PASTE_WORD_THRESHOLD,
} from "@/lib/pasted-text";
import { cn } from "@/lib/utils";
import { ChatComposerError, ChatTips } from "./chat-tips";

interface ChatComposerBaseProps {
  busy: boolean;
  canStop: boolean;
  chatStatus: ChatStatus;
  className?: string;
  disabled?: boolean;
  error: string | null;
  footerClassName?: string;
  onStop?: () => void;
  onSubmit: (text: string, files: FileUIPart[]) => void;
  onSubmitQuestionnaire?: (answers: AgentQuestionAnswer[]) => void;
  placeholder?: string;
  questionnaire?: AgentQuestionnaire | null;
  queuedMessages?: QueuedComposerMessage[];
  todos?: AgentTodo[];
}

interface ChatComposerMinimalProps extends ChatComposerBaseProps {
  variant: "minimal";
}

interface ChatComposerFullProps extends ChatComposerBaseProps {
  availableSkills?: SkillSummary[];
  contextUsage?: ChatContextUsage | null;
  currentModelSelection: string | null;
  onModelChange: (selection: string) => void;
  onNavigateSetup?: () => void;
  onThinkingEffortChange?: (effort: ThinkingEffort) => void;
  primarySupportsVision?: boolean;
  profileModelId?: string | null;
  providerConfigured?: boolean;
  providerModelGroups: Array<{
    providerId: string;
    providerLabel: string;
    models: ProviderModelOption[];
  }>;
  renderModelLabel: (selection: string | null) => string | null;
  showOfflineHint?: boolean;
  showTips?: boolean;
  thinkingEffort?: ThinkingEffort;
  thinkingEffortDisabled?: boolean;
  thinkingEffortVisible?: boolean;
  variant?: "full";
}

export type ChatComposerProps =
  | ChatComposerMinimalProps
  | ChatComposerFullProps;

const EMPTY_TODOS: AgentTodo[] = [];
const EMPTY_QUEUED_MESSAGES: QueuedComposerMessage[] = [];
const EMPTY_SKILLS: SkillSummary[] = [];

const COMPOSER_TEXTAREA_FULL_CLASS =
  "max-h-36 min-h-11 px-1 py-1.5 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-10 sm:text-sm";
const COMPOSER_TEXTAREA_MINIMAL_CLASS =
  "max-h-32 min-h-10 px-1 py-1.5 text-sm leading-relaxed placeholder:text-muted-foreground";

function ChatComposerOfflineHint({
  onNavigateSetup,
}: {
  onNavigateSetup?: () => void;
}) {
  return (
    <p
      className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-200"
      role="status"
    >
      <WifiOff01Icon aria-hidden className="size-3.5 shrink-0" />
      <span>
        No provider configured — limited responses.{" "}
        <button
          className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
          onClick={onNavigateSetup}
          type="button"
        >
          Set up provider
        </button>
      </span>
    </p>
  );
}

function ChatComposerSessionStack({
  hasQuestionnaire,
  showTodos,
  hasQueuedMessages,
  disabled,
  busy,
  questionnaire,
  onSubmitQuestionnaire,
  todos,
  queuedMessages,
  queueStackEdge,
  children,
}: {
  hasQuestionnaire: boolean;
  showTodos: boolean;
  hasQueuedMessages: boolean;
  disabled: boolean;
  busy: boolean;
  questionnaire: AgentQuestionnaire | null;
  onSubmitQuestionnaire?: (answers: AgentQuestionAnswer[]) => void;
  todos: AgentTodo[];
  queuedMessages: QueuedComposerMessage[];
  queueStackEdge: ComposerStackEdge;
  children: ReactNode;
}) {
  return (
    <div className="relative flex w-full flex-col">
      {hasQuestionnaire ? (
        <AgentQuestionnairePanel
          disabled={disabled || busy}
          onSubmit={(answers) => onSubmitQuestionnaire?.(answers)}
          questionnaire={questionnaire}
        />
      ) : null}
      {showTodos ? <AgentTodoPanel stack todos={todos} /> : null}
      {hasQueuedMessages ? (
        <ChatMessageQueuePanel
          messages={queuedMessages}
          stack
          stackEdge={queueStackEdge}
        />
      ) : null}
      <div className="relative z-10 -mt-2 w-full">{children}</div>
    </div>
  );
}

function ChatComposerPrompt({
  mode,
  shellClass,
  busy,
  disabled,
  placeholder,
  skillPickerKey,
  availableSkills,
  footerClassName,
  primarySupportsVision,
  onSubmitText,
  onAttachmentError,
  canStop,
  chatStatus,
  onStop,
  fullProps,
}: {
  mode: "minimal" | "full";
  shellClass: string;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  skillPickerKey: string;
  availableSkills: SkillSummary[];
  footerClassName?: string;
  primarySupportsVision?: boolean;
  onSubmitText: (text: string, files: FileUIPart[]) => void;
  onAttachmentError?: (message: string) => void;
  canStop: boolean;
  chatStatus: ChatStatus;
  onStop?: () => void;
  fullProps?: ChatComposerFullProps;
}) {
  const isMinimal = mode === "minimal";

  return (
    <PromptInput
      accept={isMinimal ? undefined : ALL_ATTACHMENT_ACCEPT}
      className={shellClass}
      inputGroupClassName={composerInputGroupClass}
      maxFileSize={isMinimal ? undefined : MAX_IMAGE_BYTES}
      maxFiles={isMinimal ? undefined : 5}
      multiple={!isMinimal}
      onError={
        onAttachmentError
          ? (attachmentErr) => onAttachmentError(attachmentErr.message)
          : undefined
      }
      onSubmit={({ text, files }) => {
        onSubmitText(text.trim(), files);
      }}
      prepareFiles={isMinimal ? undefined : prepareChatUploadFiles}
      rimActive={busy}
    >
      {isMinimal ? null : (
        <ChatAttachmentHeader primarySupportsVision={primarySupportsVision} />
      )}
      <PromptInputBody>
        <ChatComposerTextarea
          availableSkills={availableSkills}
          className={
            isMinimal
              ? COMPOSER_TEXTAREA_MINIMAL_CLASS
              : COMPOSER_TEXTAREA_FULL_CLASS
          }
          disabled={disabled}
          key={skillPickerKey}
          longPasteWordThreshold={
            isMinimal ? undefined : LONG_PASTE_WORD_THRESHOLD
          }
          placeholder={placeholder}
        />
      </PromptInputBody>
      <PromptInputFooter
        className={cn(
          "w-full border-0 px-0 py-0",
          isMinimal
            ? "justify-end pt-1.5"
            : "flex-nowrap items-center gap-1.5 pt-1.5",
          footerClassName
        )}
      >
        {isMinimal ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <ChatComposerSubmitButton
              busy={busy}
              canStop={canStop}
              chatStatus={chatStatus}
              disabled={disabled}
              onStop={onStop}
            />
          </div>
        ) : (
          <ChatComposerFullFooter
            busy={busy}
            canStop={canStop}
            chatStatus={chatStatus}
            disabled={disabled}
            onStop={onStop}
            props={fullProps!}
          />
        )}
      </PromptInputFooter>
    </PromptInput>
  );
}

function ChatComposerNotice({
  displayError,
  showTips,
}: {
  displayError: string | null;
  showTips: boolean;
}) {
  if (displayError) {
    return <ChatComposerError message={displayError} />;
  }
  if (showTips) {
    return <ChatTips />;
  }
  return null;
}

function ChatComposerContent({
  stacked,
  stackProps,
  notice,
  prompt,
}: {
  stacked: boolean;
  stackProps: {
    hasQuestionnaire: boolean;
    showTodos: boolean;
    hasQueuedMessages: boolean;
    disabled: boolean;
    busy: boolean;
    questionnaire: AgentQuestionnaire | null;
    onSubmitQuestionnaire?: (answers: AgentQuestionAnswer[]) => void;
    todos: AgentTodo[];
    queuedMessages: QueuedComposerMessage[];
    queueStackEdge: ComposerStackEdge;
  };
  notice: ReactNode;
  prompt: ReactNode;
}) {
  if (stacked) {
    return (
      <ChatComposerSessionStack {...stackProps}>
        {notice}
        {prompt}
      </ChatComposerSessionStack>
    );
  }

  return (
    <>
      {notice}
      {prompt}
    </>
  );
}

function deriveChatComposerState(
  props: ChatComposerProps,
  attachmentError: string | null
) {
  const isMinimal = props.variant === "minimal";
  const todos = props.todos ?? EMPTY_TODOS;
  const questionnaire = props.questionnaire ?? null;
  const queuedMessages = props.queuedMessages ?? EMPTY_QUEUED_MESSAGES;
  const displayError = props.error ?? attachmentError;
  const hasTodos = hasActiveAgentTodos(todos);
  const hasQuestionnaire = hasActiveAgentQuestionnaire(questionnaire);
  const showTodos = hasTodos && !hasQuestionnaire && !displayError;
  const hasQueuedMessages = queuedMessages.length > 0;
  const availableSkills = isMinimal
    ? EMPTY_SKILLS
    : (props.availableSkills ?? EMPTY_SKILLS);

  return {
    availableSkills,
    displayError,
    hasQuestionnaire,
    hasQueuedMessages,
    isMinimal,
    mode: (isMinimal ? "minimal" : "full") as "minimal" | "full",
    questionnaire,
    queuedMessages,
    queueStackEdge: (hasQuestionnaire || showTodos
      ? "continue"
      : "start") as ComposerStackEdge,
    shellClass: isMinimal ? composerShellCompactClass : composerShellClass,
    showOfflineHint: !isMinimal && props.showOfflineHint === true,
    showTips: !isMinimal && props.showTips === true,
    showTodos,
    skillPickerKey: availableSkills.map((skill) => skill.id).join("\0"),
    stacked: (hasQuestionnaire || showTodos || hasQueuedMessages) && !isMinimal,
    todos,
  };
}

export function ChatComposer(props: ChatComposerProps) {
  const {
    chatStatus,
    busy,
    canStop,
    disabled = false,
    placeholder = "Do anything...",
    onSubmit,
    onStop,
    className,
    footerClassName,
    onSubmitQuestionnaire,
  } = props;

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const state = deriveChatComposerState(props, attachmentError);

  const handleSubmit = (text: string, files: FileUIPart[]) => {
    setAttachmentError(null);
    onSubmit(text, files);
  };

  const fullProps = props.variant === "minimal" ? undefined : props;
  const notice = (
    <ChatComposerNotice
      displayError={state.displayError}
      showTips={state.showTips}
    />
  );

  const prompt = (
    <ChatComposerPrompt
      availableSkills={state.availableSkills}
      busy={busy}
      canStop={canStop}
      chatStatus={chatStatus}
      disabled={disabled}
      footerClassName={footerClassName}
      fullProps={fullProps}
      mode={state.mode}
      onAttachmentError={
        fullProps ? (message) => setAttachmentError(message) : undefined
      }
      onStop={onStop}
      onSubmitText={handleSubmit}
      placeholder={placeholder}
      primarySupportsVision={fullProps?.primarySupportsVision}
      shellClass={state.shellClass}
      skillPickerKey={state.skillPickerKey}
    />
  );

  return (
    <div className={cn("w-full shrink-0", className)}>
      {state.showOfflineHint ? (
        <ChatComposerOfflineHint onNavigateSetup={fullProps?.onNavigateSetup} />
      ) : null}
      <ChatComposerContent
        notice={notice}
        prompt={prompt}
        stacked={state.stacked}
        stackProps={{
          busy,
          disabled,
          hasQuestionnaire: state.hasQuestionnaire,
          hasQueuedMessages: state.hasQueuedMessages,
          onSubmitQuestionnaire,
          questionnaire: state.questionnaire,
          queuedMessages: state.queuedMessages,
          queueStackEdge: state.queueStackEdge,
          showTodos: state.showTodos,
          todos: state.todos,
        }}
      />
    </div>
  );
}

function ChatComposerTextarea({
  availableSkills,
  disabled,
  className,
  placeholder,
  longPasteWordThreshold,
}: {
  availableSkills: SkillSummary[];
  disabled: boolean;
  className: string;
  placeholder: string;
  longPasteWordThreshold?: number;
}) {
  const controller = usePromptInputController();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [slashRange, setSlashRange] = useState<SkillSlashRange | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(
    () =>
      slashRange
        ? filterComposerSlashSuggestions(availableSkills, slashRange.query)
        : [],
    [availableSkills, slashRange]
  );
  const pickerOpen = Boolean(slashRange && !disabled && suggestions.length > 0);
  const safeActiveIndex =
    suggestions.length === 0
      ? 0
      : Math.min(activeIndex, suggestions.length - 1);

  const updateSlashRange = useCallback((value: string, cursorIndex: number) => {
    setSlashRange(findActiveSkillSlashRange(value, cursorIndex));
    setActiveIndex(0);
  }, []);

  const selectSuggestion = useCallback(
    (suggestion: ComposerSlashSuggestion) => {
      const textarea = textareaRef.current;
      const value = controller.textInput.value;
      const cursorIndex = textarea?.selectionStart ?? value.length;
      const activeRange =
        slashRange ?? findActiveSkillSlashRange(value, cursorIndex);

      if (!activeRange) {
        return;
      }

      const next =
        suggestion.kind === "command"
          ? replaceSlashRangeWithReservedCommand(
              value,
              activeRange,
              suggestion.command
            )
          : replaceSlashRangeWithSkillInvocation(
              value,
              activeRange,
              suggestion.skill
            );
      controller.textInput.setInput(next.value);
      setSlashRange(null);
      setActiveIndex(0);

      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(
          next.cursorIndex,
          next.cursorIndex
        );
        textareaRef.current?.focus();
      });
    },
    [controller.textInput, slashRange]
  );

  return (
    <div className="relative min-w-0 flex-1">
      <ChatSkillTokenOverlay
        className={className}
        skills={availableSkills}
        value={controller.textInput.value}
      />
      {pickerOpen ? (
        <ChatSkillPicker
          activeIndex={safeActiveIndex}
          onSelect={selectSuggestion}
          suggestions={suggestions}
        />
      ) : null}
      <PromptInputTextarea
        className={className}
        disabled={disabled}
        longPasteWordThreshold={longPasteWordThreshold}
        onChange={(event) => {
          updateSlashRange(
            event.currentTarget.value,
            event.currentTarget.selectionStart
          );
        }}
        onKeyDown={(event) => {
          if (!pickerOpen) {
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              suggestions.length === 0 ? 0 : (current + 1) % suggestions.length
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              suggestions.length === 0
                ? 0
                : (current - 1 + suggestions.length) % suggestions.length
            );
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            setSlashRange(null);
            setActiveIndex(0);
            return;
          }

          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const suggestion = suggestions[safeActiveIndex];
            if (suggestion) {
              selectSuggestion(suggestion);
            }
          }
        }}
        placeholder={placeholder}
        ref={textareaRef}
      />
    </div>
  );
}

function ChatComposerFullFooter({
  props,
  chatStatus,
  busy,
  canStop,
  disabled,
  onStop,
}: {
  props: ChatComposerFullProps;
  chatStatus: ChatStatus;
  busy: boolean;
  canStop: boolean;
  disabled: boolean;
  onStop?: () => void;
}) {
  return (
    <>
      <div
        aria-label="Composer options"
        className={composerToolbarClass}
        role="toolbar"
      >
        {props.contextUsage ? (
          <ChatContextUsageRing usage={props.contextUsage} />
        ) : null}

        {props.providerConfigured ? (
          <div className="min-w-[4.5rem] shrink overflow-hidden">
            <PromptInputSelect
              disabled={
                busy ||
                disabled ||
                !props.providerModelGroups.some(
                  (group) => group.models.length > 0
                )
              }
              onValueChange={(value) =>
                void props.onModelChange(value == null ? "" : String(value))
              }
              value={props.currentModelSelection ?? ""}
            >
              <PromptInputSelectTrigger
                className={cn(
                  composerSelectTriggerClass,
                  "max-w-full justify-start overflow-hidden",
                  props.contextUsage && "pl-1"
                )}
                size="sm"
                title={
                  props.currentModelSelection
                    ? (props.renderModelLabel(props.currentModelSelection) ??
                      undefined)
                    : undefined
                }
              >
                <PromptInputSelectValue placeholder="Model">
                  {props.renderModelLabel}
                </PromptInputSelectValue>
              </PromptInputSelectTrigger>
              <PromptInputSelectContent
                align="start"
                alignItemWithTrigger={false}
                className="w-max max-w-[min(24rem,92vw)] text-xs"
              >
                {props.profileModelId &&
                !props.providerModelGroups.some((group) =>
                  group.models.some(
                    (model) => model.id === props.profileModelId
                  )
                ) ? (
                  <PromptInputSelectItem
                    label={props.profileModelId}
                    value={encodeModelSelection(
                      "__unknown__",
                      props.profileModelId
                    )}
                  >
                    {props.profileModelId}
                  </PromptInputSelectItem>
                ) : null}
                {props.providerModelGroups.map((group) => (
                  <div key={group.providerId}>
                    <div className="px-2 py-1.5 font-medium text-2xs text-muted-foreground">
                      {group.providerLabel}
                    </div>
                    {group.models.map((model) => {
                      const providerId = model.providerId ?? group.providerId;

                      return (
                        <PromptInputSelectItem
                          key={`${providerId}:${model.id}`}
                          label={model.name}
                          value={`${providerId}::${model.id}`}
                        >
                          {model.name}
                        </PromptInputSelectItem>
                      );
                    })}
                  </div>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </div>
        ) : (
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 font-medium text-amber-800 text-xs dark:text-amber-200">
            <WifiOff01Icon aria-hidden className="size-3.5 shrink-0" />
            Offline
          </span>
        )}

        {props.thinkingEffortVisible &&
        props.thinkingEffort &&
        props.onThinkingEffortChange ? (
          <ChatThinkingEffortControl
            disabled={props.thinkingEffortDisabled}
            effort={props.thinkingEffort}
            onEffortChange={props.onThinkingEffortChange}
            visible
          />
        ) : null}
      </div>

      <div
        aria-label="Composer actions"
        className="ml-auto flex shrink-0 items-center gap-1"
        role="toolbar"
      >
        <ChatAttachmentButton disabled={disabled} />

        <span aria-hidden className="h-4 w-px bg-border" />

        <ChatComposerSubmitButton
          busy={busy}
          canStop={canStop}
          chatStatus={chatStatus}
          disabled={disabled}
          onStop={onStop}
        />
      </div>
    </>
  );
}

/** Visible 28px face; ≥40px hit via pseudo. Keep transform in transition for press scale. */
const composerSubmitButtonClassName = cn(
  composerHitTargetClass,
  "size-7 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-[color,background-color,transform,opacity] hover:bg-primary/90 disabled:opacity-50"
);

const composerAttachmentRemoveClassName = cn(
  composerHitTargetClass,
  "absolute top-1 right-1 flex size-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-[color,background-color,transform,opacity] hover:bg-background active:scale-[0.96]"
);
function ChatComposerSubmitButton({
  chatStatus,
  busy,
  canStop,
  disabled,
  onStop,
}: {
  chatStatus: ChatStatus;
  busy: boolean;
  canStop: boolean;
  disabled: boolean;
  onStop?: () => void;
}) {
  const controller = usePromptInputController();
  const attachments = usePromptInputAttachments();
  const hasContent =
    controller.textInput.value.trim().length > 0 ||
    attachments.files.length > 0;
  const { showStop, showSubmit } = composerActions({ canStop, hasContent });

  const stopButton = showStop ? (
    <Button
      aria-label="Stop response"
      className={composerSubmitButtonClassName}
      disabled={disabled}
      key="stop"
      onClick={onStop}
      size="icon-sm"
      type="button"
      variant={hasContent ? "outline" : "default"}
    >
      <StopIcon />
    </Button>
  ) : null;

  if (!showSubmit) {
    return (
      stopButton ?? (
        <PromptInputSubmit
          aria-label="Send message"
          className={composerSubmitButtonClassName}
          disabled
          status={chatStatus}
        >
          <ArrowUp02Icon className="size-3.5" />
        </PromptInputSubmit>
      )
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {stopButton}
      <PromptInputSubmit
        aria-label={busy ? "Queue message" : "Send message"}
        className={composerSubmitButtonClassName}
        disabled={disabled}
        status={chatStatus}
      >
        <ArrowUp02Icon className="size-3.5" />
      </PromptInputSubmit>
    </div>
  );
}

function ChatAttachmentHeader({
  primarySupportsVision,
}: {
  primarySupportsVision?: boolean;
}) {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  const useImageAttachmentPreview = primarySupportsVision === false;

  return (
    <PromptInputHeader className="pb-0">
      <div className="flex w-full flex-wrap gap-2 border-border/60 border-b pb-3">
        {attachments.files.map((file) => {
          const filename = file.filename ?? "Document";
          const mediaType = file.mediaType ?? "";

          if (isImageFilePart(file)) {
            if (useImageAttachmentPreview) {
              return (
                <ImageAttachmentPreview
                  key={file.id}
                  onRemove={() => attachments.remove(file.id)}
                  url={file.url}
                />
              );
            }

            return (
              <div
                className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-muted outline outline-1 outline-black/10 dark:outline-white/10"
                key={file.id}
              >
                <img
                  alt={filename}
                  className="size-full object-cover"
                  src={file.url}
                />
                <button
                  aria-label={`Remove ${filename}`}
                  className={composerAttachmentRemoveClassName}
                  onClick={() => attachments.remove(file.id)}
                  type="button"
                >
                  <Cancel01Icon className="size-3.5" />
                </button>
              </div>
            );
          }

          if (isPastedTextDocument(filename, mediaType)) {
            return (
              <TextAttachmentPreview
                filename={filename}
                key={file.id}
                onRemove={() => attachments.remove(file.id)}
              />
            );
          }

          return (
            <div
              className="relative flex max-w-full shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-muted px-3 py-2"
              key={file.id}
            >
              <File01Icon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="truncate font-medium text-foreground text-xs">
                {filename}
              </span>
              <button
                aria-label={`Remove ${filename}`}
                className={composerAttachmentRemoveClassName}
                onClick={() => attachments.remove(file.id)}
                type="button"
              >
                <Cancel01Icon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </PromptInputHeader>
  );
}

function ChatAttachmentButton({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();

  const openPicker = (accept: string) => {
    const input = attachments.fileInputRef.current;

    if (!input) {
      attachments.openFileDialog();
      return;
    }

    input.accept = accept;
    input.click();
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="Add attachment"
                  className={composerIconButtonClass}
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Add01Icon className="size-3.5" />
                </Button>
              }
            />
          }
        />
        <TooltipContent side="top">Add attachment</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => openPicker(IMAGE_ACCEPT)}
        >
          <Image01Icon aria-hidden className="size-4 text-muted-foreground" />
          Image
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => openPicker(DOCUMENT_ACCEPT)}
        >
          <File01Icon aria-hidden className="size-4 text-muted-foreground" />
          Document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StopIcon() {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[2px] bg-current"
    />
  );
}
