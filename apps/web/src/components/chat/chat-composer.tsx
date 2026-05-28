import type { ProfileSummary } from "@tinyclaw/core/contract";
import type { ChatStatus } from "ai";
import type { FileUIPart } from "ai";
import { ArrowUpIcon, ImageIcon, SquareIcon, WifiOffIcon, XIcon } from "lucide-react";
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
import {
  composerIconButtonClass,
  composerShellClass,
  composerShellCompactClass,
  composerToolbarClass,
} from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

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
  onNavigateSettings?: () => void;
  providerModels: Array<{ id: string; name: string }>;
  currentModel: string | null;
  onModelChange: (modelId: string) => void;
  renderModelLabel: (modelId: string | null) => string | null;
}

export type ChatComposerProps = ChatComposerMinimalProps | ChatComposerFullProps;

export function ChatComposer(props: ChatComposerProps) {
  const {
    chatStatus,
    busy,
    canStop,
    disabled = false,
    error,
    placeholder = "Message…",
    onSubmit,
    onStop,
    className,
    footerClassName,
  } = props;

  const isMinimal = props.variant === "minimal";
  const shellClass = isMinimal ? composerShellCompactClass : composerShellClass;

  return (
    <div className={cn("shrink-0 space-y-2", className)}>
      <p
        className={`min-h-5 text-sm ${error ? "text-destructive" : "invisible"}`}
        role={error ? "alert" : undefined}
        aria-hidden={!error}
      >
        {error ?? "\u00a0"}
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
              onClick={props.onNavigateSettings}
            >
              Configure in Settings
            </button>
          </span>
        </p>
      ) : null}
      <PromptInput
        accept={isMinimal ? undefined : "image/*"}
        multiple={!isMinimal}
        maxFiles={isMinimal ? undefined : 5}
        className={shellClass}
        onSubmit={({ text, files }) => onSubmit(text.trim(), files)}
      >
        {!isMinimal ? <ChatAttachmentHeader /> : null}
        <PromptInputBody>
          <PromptInputTextarea
            className={
              isMinimal
                ? "min-h-10 max-h-32 px-1 py-1.5 text-sm leading-relaxed placeholder:text-muted-foreground"
                : "min-h-11 max-h-36 px-1 py-1.5 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-10 sm:text-sm"
            }
            placeholder={placeholder}
            disabled={disabled || busy}
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
            <PromptInputSubmit
              status={chatStatus}
              disabled={disabled || (busy && !canStop)}
              onStop={canStop ? onStop : undefined}
              aria-label={canStop ? "Stop response" : busy ? "Sending message" : "Send message"}
              className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {canStop ? (
                <SquareIcon className="size-3.5" />
              ) : (
                <ArrowUpIcon className="size-3.5" />
              )}
            </PromptInputSubmit>
          ) : (
            <>
              <div
                role="toolbar"
                aria-label="Composer options"
                className={composerToolbarClass}
              >
                <PromptInputTools className="gap-1.5">
                  <ChatAttachmentButton disabled={disabled || busy} />
                </PromptInputTools>

                <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

                {props.providerConfigured ? (
                  <PromptInputSelect
                    value={props.currentModel ?? ""}
                    disabled={!props.providerModels.length || busy}
                    onValueChange={(value) =>
                      void props.onModelChange(value != null ? String(value) : "")
                    }
                  >
                    <PromptInputSelectTrigger className="h-8 max-w-[min(12rem,42vw)] truncate rounded-full bg-muted px-2.5 text-[11px] font-medium leading-none text-foreground hover:bg-muted/80 sm:text-xs">
                      <PromptInputSelectValue placeholder="Model">
                        {props.renderModelLabel}
                      </PromptInputSelectValue>
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent className="text-xs">
                      {props.providerModels.map((model) => (
                        <PromptInputSelectItem
                          key={model.id}
                          value={model.id}
                          label={model.name}
                        >
                          {model.name}
                        </PromptInputSelectItem>
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
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
                  <DropdownMenuContent align="end" className="min-w-52 w-auto">
                    {props.profiles.map((profile) => (
                      <DropdownMenuItem
                        key={profile.id}
                        disabled={busy || profile.id === props.profileId}
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

                <span className="h-5 w-px bg-border" aria-hidden />

                <PromptInputSubmit
                  status={chatStatus}
                  disabled={disabled || (busy && !canStop)}
                  onStop={canStop ? onStop : undefined}
                  aria-label={
                    canStop ? "Stop response" : busy ? "Sending message" : "Send message"
                  }
                  className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {canStop ? (
                    <SquareIcon className="size-3.5" />
                  ) : (
                    <ArrowUpIcon className="size-3.5" />
                  )}
                </PromptInputSubmit>
              </div>
            </>
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function ChatAttachmentHeader() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <PromptInputHeader className="pb-0">
      <div className="flex w-full flex-wrap gap-2 border-b border-border/60 pb-3">
        {attachments.files.map((file) => (
          <div
            key={file.id}
            className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
          >
            <img
              src={file.url}
              alt={file.filename ?? "attachment preview"}
              className="size-full object-cover"
            />
            <button
              type="button"
              className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
              aria-label={`Remove ${file.filename ?? "attachment"}`}
              onClick={() => attachments.remove(file.id)}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </PromptInputHeader>
  );
}

function ChatAttachmentButton({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Add image"
            className={composerIconButtonClass}
            onClick={() => attachments.openFileDialog()}
          >
            <ImageIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipContent side="top">Add image</TooltipContent>
    </Tooltip>
  );
}
