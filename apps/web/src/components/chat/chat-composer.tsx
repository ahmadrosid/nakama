import { hasActiveAgentTodos } from "@nakama/core/agent-todo";
import type {
  AgentQuestionAnswer,
  AgentQuestionnaire,
  AgentTodo,
  ProviderModelOption,
  ProfileSummary,
  SkillSummary,
} from "@nakama/core/contract";
import type { ChatStatus } from "ai";
import type { FileUIPart } from "ai";
import { ArrowUpIcon, FileTextIcon, PlusIcon, WifiOffIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
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
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
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
import { MAX_IMAGE_BYTES } from "@nakama/core/message-content";
import {
  ALL_ATTACHMENT_ACCEPT,
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  isImageFilePart,
} from "@/lib/chat-images";
import { prepareChatUploadFiles } from "@/lib/compress-image";
import {
  composerIconButtonClass,
  composerShellClass,
  composerShellCompactClass,
  composerInputGroupClass,
  composerToolbarClass,
} from "@/lib/chat-stream";
import { AgentTodoPanel } from "@/components/chat/AgentTodoPanel";
import { AgentQuestionnairePanel } from "@/components/chat/AgentQuestionnairePanel";
import {
  ChatMessageQueuePanel,
  type QueuedComposerMessage,
} from "@/components/chat/ChatMessageQueuePanel";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { ChatSkillPicker } from "@/components/chat/chat-skill-picker";
import { ChatSkillTokenOverlay } from "@/components/chat/chat-skill-token-overlay";
import { cn } from "@/lib/utils";
import {
  isPastedTextDocument,
  LONG_PASTE_WORD_THRESHOLD,
} from "@/lib/pasted-text";
import {
  encodeModelSelection,
  modelSelectContentMaxHeightClass,
} from "@/lib/models";
import {
  filterSkillsForSlashQuery,
  findActiveSkillSlashRange,
  replaceSlashRangeWithSkillInvocation,
  type SkillSlashRange,
} from "@/lib/chat-composer-skills";

interface ChatComposerBaseProps {
  chatStatus: ChatStatus;
  busy: boolean;
  canStop: boolean;
  disabled?: boolean;
  error: string | null;
  placeholder?: string;
  onSubmit: (text: string, files: FileUIPart[]) => void;
  onStop?: () => void;
  className?: string;
  footerClassName?: string;
  todos?: AgentTodo[];
  questionnaire?: AgentQuestionnaire | null;
  queuedMessages?: QueuedComposerMessage[];
  onSubmitQuestionnaire?: (answers: AgentQuestionAnswer[]) => void;
}

interface ChatComposerMinimalProps extends ChatComposerBaseProps {
  variant: "minimal";
}

interface ChatComposerFullProps extends ChatComposerBaseProps {
  variant?: "full";
  profileId: string;
  profiles: ProfileSummary[];
  activeProfile?: ProfileSummary;
  onProfileSwitch: (profileId: string) => void;
  showOfflineHint?: boolean;
  providerConfigured?: boolean;
  onNavigateSetup?: () => void;
  providerModelGroups: Array<{
    providerId: string;
    providerLabel: string;
    models: ProviderModelOption[];
  }>;
  profileModelId?: string | null;
  currentModelSelection: string | null;
  primarySupportsVision?: boolean;
  availableSkills?: SkillSummary[];
  onModelChange: (selection: string) => void;
  renderModelLabel: (selection: string | null) => string | null;
}

export type ChatComposerProps = ChatComposerMinimalProps | ChatComposerFullProps;

export function ChatComposer(props: ChatComposerProps) {
  const {
    chatStatus,
    busy,
    canStop,
    disabled = false,
    error,
    placeholder = "Do anything...",
    onSubmit,
    onStop,
    className,
    footerClassName,
    todos = [],
    questionnaire = null,
    queuedMessages = [],
    onSubmitQuestionnaire,
  } = props;

  const isMinimal = props.variant === "minimal";
  const hasTodos = hasActiveAgentTodos(todos);
  const hasQuestionnaire = Boolean(questionnaire && questionnaire.questions.length > 0);
  const hasQueuedMessages = queuedMessages.length > 0;
  const shellClass = isMinimal ? composerShellCompactClass : composerShellClass;
  const availableSkills = isMinimal ? [] : (props.availableSkills ?? []);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const displayError = error ?? attachmentError;

  return (
    <div className={cn("w-full shrink-0 space-y-2", className)}>
      <p
        className={`min-h-5 text-sm ${displayError ? "text-destructive" : "invisible"}`}
        role={displayError ? "alert" : undefined}
        aria-hidden={!displayError}
      >
        {displayError ?? "\u00a0"}
      </p>
      {!isMinimal && props.showOfflineHint ? (
        <p
          className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
          <span>
            No provider configured — limited responses.{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
              onClick={props.onNavigateSetup}
            >
              Set up provider
            </button>
          </span>
        </p>
      ) : null}
      {(hasQuestionnaire || hasTodos || hasQueuedMessages) && !isMinimal ? (
        <div className="relative flex w-full flex-col">
          {hasQuestionnaire ? (
            <AgentQuestionnairePanel
              questionnaire={questionnaire}
              disabled={disabled || busy}
              onSubmit={(answers) => onSubmitQuestionnaire?.(answers)}
            />
          ) : null}
          <AgentTodoPanel todos={todos} stack />
          {hasQueuedMessages ? <ChatMessageQueuePanel messages={queuedMessages} stack /> : null}
          <div className="relative z-10 -mt-2 w-full">
            <PromptInput
              accept={ALL_ATTACHMENT_ACCEPT}
              multiple
              maxFiles={5}
              maxFileSize={MAX_IMAGE_BYTES}
              prepareFiles={prepareChatUploadFiles}
              onError={(attachmentErr) => setAttachmentError(attachmentErr.message)}
              className={shellClass}
              inputGroupClassName={composerInputGroupClass}
              onSubmit={({ text, files }) => {
                setAttachmentError(null);
                onSubmit(text.trim(), files);
              }}
            >
              <ChatAttachmentHeader primarySupportsVision={props.primarySupportsVision} />
              <PromptInputBody>
                <ChatComposerTextarea
                  className="min-h-11 max-h-36 px-1 py-1.5 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-10 sm:text-sm"
                  placeholder={placeholder}
                  disabled={disabled}
                  availableSkills={availableSkills}
                  longPasteWordThreshold={LONG_PASTE_WORD_THRESHOLD}
                />
              </PromptInputBody>
              <PromptInputFooter
                className={cn(
                  "w-full border-0 px-0 pb-0",
                  "flex-wrap items-center gap-2 pt-2.5",
                  footerClassName,
                )}
              >
                <ChatComposerFullFooter
                  props={props}
                  chatStatus={chatStatus}
                  busy={busy}
                  canStop={canStop}
                  disabled={disabled}
                  onStop={onStop}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      ) : (
      <PromptInput
        accept={isMinimal ? undefined : ALL_ATTACHMENT_ACCEPT}
        multiple={!isMinimal}
        maxFiles={isMinimal ? undefined : 5}
        maxFileSize={isMinimal ? undefined : MAX_IMAGE_BYTES}
        prepareFiles={isMinimal ? undefined : prepareChatUploadFiles}
        onError={
          isMinimal
            ? undefined
            : (attachmentErr) => setAttachmentError(attachmentErr.message)
        }
        className={shellClass}
        inputGroupClassName={composerInputGroupClass}
        onSubmit={({ text, files }) => {
          setAttachmentError(null);
          onSubmit(text.trim(), files);
        }}
      >
        {!isMinimal ? (
          <ChatAttachmentHeader primarySupportsVision={props.primarySupportsVision} />
        ) : null}
        <PromptInputBody>
          <ChatComposerTextarea
            className={
              isMinimal
                ? "min-h-10 max-h-32 px-1 py-1.5 text-sm leading-relaxed placeholder:text-muted-foreground"
                : "min-h-11 max-h-36 px-1 py-1.5 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-10 sm:text-sm"
            }
            placeholder={placeholder}
            disabled={disabled}
            availableSkills={availableSkills}
            longPasteWordThreshold={isMinimal ? undefined : LONG_PASTE_WORD_THRESHOLD}
          />
        </PromptInputBody>
        <PromptInputFooter
          className={cn(
            "w-full border-0 px-0 pb-0",
            isMinimal
              ? "justify-end pt-2"
              : "flex-wrap items-center gap-2 pt-2.5",
            footerClassName,
          )}
        >
          {isMinimal ? (
            <ChatComposerSubmitButton
              chatStatus={chatStatus}
              busy={busy}
              canStop={canStop}
              disabled={disabled}
              onStop={onStop}
            />
          ) : (
            <ChatComposerFullFooter
              props={props}
              chatStatus={chatStatus}
              busy={busy}
              canStop={canStop}
              disabled={disabled}
              onStop={onStop}
            />
          )}
        </PromptInputFooter>
      </PromptInput>
      )}
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
        ? filterSkillsForSlashQuery(availableSkills, slashRange.query)
        : [],
    [availableSkills, slashRange],
  );
  const pickerOpen = Boolean(slashRange && availableSkills.length > 0 && !disabled);

  useEffect(() => {
    setSlashRange(null);
    setActiveIndex(0);
  }, [availableSkills]);

  useEffect(() => {
    if (activeIndex >= suggestions.length) {
      setActiveIndex(Math.max(0, suggestions.length - 1));
    }
  }, [activeIndex, suggestions.length]);

  const updateSlashRange = useCallback((value: string, cursorIndex: number) => {
    setSlashRange(findActiveSkillSlashRange(value, cursorIndex));
    setActiveIndex(0);
  }, []);

  const selectSkill = useCallback(
    (skill: SkillSummary) => {
      const textarea = textareaRef.current;
      const value = controller.textInput.value;
      const cursorIndex = textarea?.selectionStart ?? value.length;
      const activeRange = slashRange ?? findActiveSkillSlashRange(value, cursorIndex);

      if (!activeRange) {
        return;
      }

      const next = replaceSlashRangeWithSkillInvocation(value, activeRange, skill);
      controller.textInput.setInput(next.value);
      setSlashRange(null);
      setActiveIndex(0);

      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(next.cursorIndex, next.cursorIndex);
        textareaRef.current?.focus();
      });
    },
    [controller.textInput, slashRange],
  );

  return (
    <div className="relative min-w-0 flex-1">
      <ChatSkillTokenOverlay
        value={controller.textInput.value}
        skills={availableSkills}
        className={className}
      />
      {pickerOpen ? (
        <ChatSkillPicker
          skills={suggestions}
          activeIndex={activeIndex}
          onSelect={selectSkill}
        />
      ) : null}
      <PromptInputTextarea
        ref={textareaRef}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        longPasteWordThreshold={longPasteWordThreshold}
        onChange={(event) => {
          updateSlashRange(
            event.currentTarget.value,
            event.currentTarget.selectionStart,
          );
        }}
        onKeyDown={(event) => {
          if (!pickerOpen) {
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              suggestions.length === 0 ? 0 : (current + 1) % suggestions.length,
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              suggestions.length === 0
                ? 0
                : (current - 1 + suggestions.length) % suggestions.length,
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
            const skill = suggestions[activeIndex];
            if (skill) {
              selectSkill(skill);
            }
          }
        }}
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
        role="toolbar"
        aria-label="Composer options"
        className={composerToolbarClass}
      >
        <PromptInputTools className="gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    props.activeProfile
                      ? `Switch profile (${props.activeProfile.name})`
                      : "Switch profile"
                  }
                  title={props.activeProfile?.name ?? "Switch profile"}
                  className={cn(composerIconButtonClass, "p-0")}
                />
              }
            >
              {props.activeProfile ? (
                <ProfileAvatar profile={props.activeProfile} size="sm" className="size-7" />
              ) : (
                <span className="text-xs font-medium">?</span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52 w-auto">
              {props.profiles.map((profile) => (
                <DropdownMenuItem
                  key={profile.id}
                  disabled={profile.id === props.profileId}
                  onClick={() => void props.onProfileSwitch(profile.id)}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ProfileAvatar profile={profile} size="sm" />
                    <span className="whitespace-nowrap">
                      {profile.name}
                      {profile.isSuper ? " (super)" : ""}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </PromptInputTools>

        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

        {props.providerConfigured ? (
          <PromptInputSelect
            value={props.currentModelSelection ?? ""}
            disabled={
              !props.providerModelGroups.some((group) => group.models.length > 0)
            }
            onValueChange={(value) =>
              void props.onModelChange(value != null ? String(value) : "")
            }
          >
            <PromptInputSelectTrigger
              className="h-8 w-auto max-w-[min(16rem,52vw)] rounded-full bg-muted px-2.5 text-[11px] font-medium leading-none text-foreground hover:bg-muted/80 sm:max-w-[min(20rem,60vw)] sm:text-xs"
              title={
                props.currentModelSelection
                  ? (props.renderModelLabel(props.currentModelSelection) ?? undefined)
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
              className={cn(
                "w-max max-w-[min(24rem,92vw)] text-xs",
                modelSelectContentMaxHeightClass,
              )}
            >
              {props.profileModelId &&
              !props.providerModelGroups.some((group) =>
                group.models.some((model) => model.id === props.profileModelId),
              ) ? (
                <PromptInputSelectItem
                  value={encodeModelSelection("__unknown__", props.profileModelId)}
                  label={props.profileModelId}
                >
                  {props.profileModelId}
                </PromptInputSelectItem>
              ) : null}
              {props.providerModelGroups.map((group) => (
                <div key={group.providerId}>
                  <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                    {group.providerLabel}
                  </div>
                  {group.models.map((model) => {
                    const providerId = model.providerId ?? group.providerId;

                    return (
                      <PromptInputSelectItem
                        key={`${providerId}:${model.id}`}
                        value={`${providerId}::${model.id}`}
                        label={model.name}
                      >
                        {model.name}
                      </PromptInputSelectItem>
                    );
                  })}
                </div>
              ))}
            </PromptInputSelectContent>
          </PromptInputSelect>
        ) : (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 text-xs font-medium text-amber-800 dark:text-amber-200">
            <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
            Offline
          </span>
        )}
      </div>

      <div
        role="toolbar"
        aria-label="Composer actions"
        className="ml-auto flex shrink-0 items-center gap-1.5"
      >
        <ChatAttachmentButton disabled={disabled} />

        <span className="h-5 w-px bg-border" aria-hidden />

        <ChatComposerSubmitButton
          chatStatus={chatStatus}
          busy={busy}
          canStop={canStop}
          disabled={disabled}
          onStop={onStop}
        />
      </div>
    </>
  );
}

const composerSubmitButtonClassName =
  "size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-50";

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
    controller.textInput.value.trim().length > 0 || attachments.files.length > 0;
  const showStop = canStop && !hasContent;

  if (showStop) {
    return (
      <Button
        type="button"
        variant="default"
        size="icon-sm"
        disabled={disabled}
        aria-label="Stop response"
        onClick={onStop}
        className={composerSubmitButtonClassName}
      >
        <StopIcon />
      </Button>
    );
  }

  return (
    <PromptInputSubmit
      status={chatStatus}
      disabled={disabled || !hasContent}
      aria-label={busy ? "Queue message" : "Send message"}
      className={composerSubmitButtonClassName}
    >
      <ArrowUpIcon className="size-3.5" />
    </PromptInputSubmit>
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
      <div className="flex w-full flex-wrap gap-2 border-b border-border/60 pb-3">
        {attachments.files.map((file) => {
          const filename = file.filename ?? "Document";
          const mediaType = file.mediaType ?? "";

          if (isImageFilePart(file)) {
            if (useImageAttachmentPreview) {
              return (
                <ImageAttachmentPreview
                  key={file.id}
                  url={file.url}
                  onRemove={() => attachments.remove(file.id)}
                />
              );
            }

            return (
              <div
                key={file.id}
                className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
              >
                <img
                  src={file.url}
                  alt={filename}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
                  aria-label={`Remove ${filename}`}
                  onClick={() => attachments.remove(file.id)}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            );
          }

          if (isPastedTextDocument(filename, mediaType)) {
            return (
              <TextAttachmentPreview
                key={file.id}
                filename={filename}
                onRemove={() => attachments.remove(file.id)}
              />
            );
          }

          return (
            <div
              key={file.id}
              className="relative flex max-w-full shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-muted px-3 py-2"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-xs font-medium text-foreground">{filename}</span>
              <button
                type="button"
                className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
                aria-label={`Remove ${filename}`}
                onClick={() => attachments.remove(file.id)}
              >
                <XIcon className="size-3.5" />
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
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label="Add attachment"
                  className={composerIconButtonClass}
                >
                  <PlusIcon className="size-3.5" />
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
          Image
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => openPicker(DOCUMENT_ACCEPT)}
        >
          Document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StopIcon() {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-[2px] bg-current"
      aria-hidden
    />
  );
}
