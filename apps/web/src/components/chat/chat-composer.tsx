import { hasActiveAgentTodos } from "@nakama/core/agent-todo";
import type {
  AgentTodo,
  ChatUsage,
  ProviderModelOption,
  SkillSummary,
} from "@nakama/core/contract";
import { MAX_IMAGE_BYTES } from "@nakama/core/message-content";
import { Button } from "@nakama/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nakama/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { Spinner } from "@nakama/ui/spinner";
import { toast } from "@nakama/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  Add01Icon,
  Alert02Icon,
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  File01Icon,
  Folder01Icon,
  Image01Icon,
  Plug01Icon,
  PuzzleIcon,
  Settings01Icon,
  WifiOff01Icon,
} from "hugeicons-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { AgentTodoPanel } from "@/components/chat/AgentTodoPanel";
import {
  ChatMessageQueuePanel,
  type QueuedComposerMessage,
} from "@/components/chat/ChatMessageQueuePanel";
import { ChatAddCapabilitiesDialogs } from "@/components/chat/chat-add-capabilities-dialogs";
import { ChatContextUsageRing } from "@/components/chat/chat-context-usage";
import { ChatSkillPicker } from "@/components/chat/chat-skill-picker";
import { ChatSkillTokenOverlay } from "@/components/chat/chat-skill-token-overlay";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import { useAuth } from "@/context/use-auth";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import {
  useMcpServersQuery,
  useProfileQuery,
  useSkillsQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import { pluginAgentAccessState, useOrgPlugins } from "@/hooks/use-plugins";
import {
  useAssignMcpServerMutation,
  useUnassignMcpServerMutation,
} from "@/hooks/use-resource-mutations";
import type { ChatStatus, FileUIPart } from "@/lib/ai-ui-types";
import {
  type ComposerAddCommandAction,
  type ComposerOpenPlugin,
  type ComposerSuggestion,
  filterComposerMentionSuggestions,
  filterComposerSlashSuggestions,
  findActiveSkillSlashRange,
  getLeadingCommand,
  matchComposerAddCommand,
  matchComposerBtwCommand,
  matchComposerLearningLoopCommand,
  matchComposerOpenCommand,
  replaceSlashRangeWithReservedCommand,
  replaceSlashRangeWithSkillInvocation,
  type SkillSlashRange,
} from "@/lib/chat-composer-skills";
import type { ChatContextUsage } from "@/lib/chat-context-usage";
import { storeComposerDraft } from "@/lib/chat-history";
import {
  ALL_ATTACHMENT_ACCEPT,
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  isImageFilePart,
  MAX_FOLDER_FILES,
  selectFolderFiles,
} from "@/lib/chat-images";
import {
  type ComposerStackEdge,
  composerHitTargetClass,
  composerIconButtonClass,
  composerInputGroupClass,
  composerShellClass,
  composerShellCompactClass,
  composerToolbarClass,
} from "@/lib/chat-stream";
import { formatError } from "@/lib/client";
import { prepareChatUploadFiles } from "@/lib/compress-image";
import { encodeModelSelection } from "@/lib/models";
import { enabledPluginNavEntries, profilePath } from "@/lib/navigation";
import {
  isPastedTextDocument,
  LONG_PASTE_WORD_THRESHOLD,
} from "@/lib/pasted-text";
import { THINKING_EFFORT_OPTIONS } from "@/lib/thinking-settings";
import { PluginView } from "@/pages/PluginPage";
import { composerActions } from "./chat-composer.shared";
import { ChatComposerError, ChatTips } from "./chat-tips";

interface ChatComposerBaseProps {
  busy: boolean;
  canStop: boolean;
  chatStatus: ChatStatus;
  className?: string;
  disabled?: boolean;
  draftStorageKey?: string | null;
  error: string | null;
  footerClassName?: string;
  onStop?: () => void;
  onSubmit: (text: string, files: FileUIPart[]) => void;
  placeholder?: string;
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
  headerNotice?: ReactNode;
  /** Set on the main chat page: `/btw …` opens a side chat with the question. */
  onBtw?: (question: string) => void;
  onConnectProvider?: () => void;
  onModelChange: (selection: string) => void;
  onThinkingEffortChange?: (effort: string) => void;
  primarySupportsVision?: boolean;
  profileId?: string | null;
  profileModelId?: string | null;
  providerConfigured?: boolean;
  providerModelGroups: Array<{
    providerId: string;
    providerLabel: string;
    models: ProviderModelOption[];
  }>;
  renderModelLabel: (selection: string | null) => string | null;
  sessionUsage?: ChatUsage | null;
  showOfflineHint?: boolean;
  showTips?: boolean;
  thinkingEffort?: string;
  thinkingEffortDisabled?: boolean;
  /** Overrides the built-in low/medium/high list, for ACP agents that offer their own levels. */
  thinkingEffortOptions?: Array<{ label: string; value: string }>;
  thinkingEffortVisible?: boolean;
  variant?: "full";
}

export type ChatComposerProps =
  | ChatComposerMinimalProps
  | ChatComposerFullProps;

const EMPTY_TODOS: AgentTodo[] = [];

const EMPTY_QUEUED_MESSAGES: QueuedComposerMessage[] = [];

const EMPTY_SKILLS: SkillSummary[] = [];

function ChatComposerNotice({
  error,
  headerNotice,
  showTips,
}: {
  error: string | null;
  headerNotice?: ReactNode;
  showTips: boolean;
}) {
  if (error) {
    return <ChatComposerError message={error} />;
  }

  if (headerNotice) {
    return headerNotice;
  }

  if (showTips) {
    return <ChatTips />;
  }

  return null;
}

function ChatComposerOfflineHint({
  onConnectProvider,
}: {
  onConnectProvider?: () => void;
}) {
  return (
    <div
      className="mx-4 mb-2 flex flex-col gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Alert02Icon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
        />
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold text-foreground text-sm">
            One more step to start chatting
          </p>
          <p className="text-muted-foreground text-sm">
            Connect an AI service so Nakama can respond to your messages.
          </p>
        </div>
      </div>
      <Button
        className="shrink-0 self-start sm:self-auto"
        onClick={onConnectProvider}
        size="sm"
        type="button"
      >
        Set up AI
      </Button>
    </div>
  );
}

function ChatComposerWorkStack({
  hasQueuedMessages,
  queueStackEdge,
  queuedMessages,
  showTodos,
  todos,
}: {
  hasQueuedMessages: boolean;
  queueStackEdge: ComposerStackEdge;
  queuedMessages: QueuedComposerMessage[];
  showTodos: boolean;
  todos: AgentTodo[];
}) {
  return (
    <>
      {showTodos ? <AgentTodoPanel stack todos={todos} /> : null}
      {hasQueuedMessages ? (
        <ChatMessageQueuePanel
          messages={queuedMessages}
          stack
          stackEdge={queueStackEdge}
        />
      ) : null}
    </>
  );
}

const FULL_TEXTAREA_CLASS =
  "max-h-36 min-h-9 px-1 py-1 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-8 sm:text-sm";

const MINIMAL_TEXTAREA_CLASS =
  "max-h-32 min-h-10 px-1 py-1.5 text-sm leading-relaxed placeholder:text-muted-foreground";

function ChatComposerStackedPrompt({
  availableSkills,
  busy,
  canStop,
  chatStatus,
  disabled,
  displayError,
  footerClassName,
  headerNotice,
  onAddCommand,
  onStop,
  onSubmit,
  placeholder,
  primarySupportsVision,
  props,
  setAttachmentError,
  showTips,
  skillPickerKey,
}: {
  availableSkills: SkillSummary[];
  busy: boolean;
  canStop: boolean;
  chatStatus: ChatStatus;
  disabled: boolean;
  displayError: string | null;
  footerClassName?: string;
  headerNotice?: ReactNode;
  onAddCommand?: (action: ComposerAddCommandAction) => void;
  onStop?: () => void;
  onSubmit: (text: string, files: FileUIPart[]) => void;
  placeholder: string;
  primarySupportsVision?: boolean;
  props: ChatComposerFullProps;
  setAttachmentError: (message: string | null) => void;
  showTips: boolean;
  skillPickerKey: string;
}) {
  return (
    <>
      <ChatComposerNotice
        error={displayError}
        headerNotice={headerNotice}
        showTips={showTips}
      />
      <PromptInput
        accept={ALL_ATTACHMENT_ACCEPT}
        className={composerShellClass}
        inputGroupClassName={composerInputGroupClass}
        maxFileSize={MAX_IMAGE_BYTES}
        maxFiles={MAX_FOLDER_FILES}
        multiple
        onError={(attachmentErr) => setAttachmentError(attachmentErr.message)}
        onSubmit={({ text, files }) => {
          setAttachmentError(null);
          onSubmit(text.trim(), files);
        }}
        prepareFiles={prepareChatUploadFiles}
        rimActive={busy}
      >
        <ChatComposerCommandBanner availableSkills={availableSkills} />
        <ChatAttachmentHeader primarySupportsVision={primarySupportsVision} />
        <PromptInputBody>
          <ChatComposerTextarea
            availableSkills={availableSkills}
            className={FULL_TEXTAREA_CLASS}
            disabled={disabled}
            key={skillPickerKey}
            longPasteWordThreshold={LONG_PASTE_WORD_THRESHOLD}
            onAddCommand={onAddCommand}
            placeholder={placeholder}
          />
        </PromptInputBody>
        <PromptInputFooter
          className={cn(
            "w-full border-0 px-0 py-0",
            "flex-nowrap items-center gap-1.5 pt-1",
            footerClassName
          )}
        >
          <ChatComposerFullFooter
            busy={busy}
            canStop={canStop}
            chatStatus={chatStatus}
            disabled={disabled}
            onStop={onStop}
            props={props}
          />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}

function ChatComposerBarePrompt({
  availableSkills,
  busy,
  canStop,
  chatStatus,
  disabled,
  displayError,
  footerClassName,
  headerNotice,
  isMinimal,
  onAddCommand,
  onStop,
  onSubmit,
  placeholder,
  primarySupportsVision,
  fullProps,
  setAttachmentError,
  showTips,
  skillPickerKey,
}: {
  availableSkills: SkillSummary[];
  busy: boolean;
  canStop: boolean;
  chatStatus: ChatStatus;
  disabled: boolean;
  displayError: string | null;
  footerClassName?: string;
  headerNotice?: ReactNode;
  isMinimal: boolean;
  onAddCommand?: (action: ComposerAddCommandAction) => void;
  onStop?: () => void;
  onSubmit: (text: string, files: FileUIPart[]) => void;
  placeholder: string;
  primarySupportsVision?: boolean;
  fullProps?: ChatComposerFullProps;
  setAttachmentError: (message: string | null) => void;
  showTips: boolean;
  skillPickerKey: string;
}) {
  return (
    <>
      <ChatComposerNotice
        error={displayError}
        headerNotice={headerNotice}
        showTips={showTips}
      />
      <PromptInput
        accept={isMinimal ? undefined : ALL_ATTACHMENT_ACCEPT}
        className={isMinimal ? composerShellCompactClass : composerShellClass}
        inputGroupClassName={composerInputGroupClass}
        maxFileSize={isMinimal ? undefined : MAX_IMAGE_BYTES}
        maxFiles={isMinimal ? undefined : MAX_FOLDER_FILES}
        multiple={!isMinimal}
        onError={
          isMinimal
            ? undefined
            : (attachmentErr) => setAttachmentError(attachmentErr.message)
        }
        onSubmit={({ text, files }) => {
          setAttachmentError(null);
          onSubmit(text.trim(), files);
        }}
        prepareFiles={isMinimal ? undefined : prepareChatUploadFiles}
        rimActive={busy}
      >
        <ChatComposerCommandBanner availableSkills={availableSkills} />
        {isMinimal ? null : (
          <ChatAttachmentHeader primarySupportsVision={primarySupportsVision} />
        )}
        <PromptInputBody>
          <ChatComposerTextarea
            availableSkills={availableSkills}
            className={isMinimal ? MINIMAL_TEXTAREA_CLASS : FULL_TEXTAREA_CLASS}
            disabled={disabled}
            key={skillPickerKey}
            longPasteWordThreshold={
              isMinimal ? undefined : LONG_PASTE_WORD_THRESHOLD
            }
            onAddCommand={onAddCommand}
            placeholder={placeholder}
          />
        </PromptInputBody>
        <PromptInputFooter
          className={cn(
            "w-full border-0 px-0 py-0",
            isMinimal
              ? "justify-end pt-1.5"
              : "flex-nowrap items-center gap-1.5 pt-1",
            footerClassName
          )}
        >
          {isMinimal || !fullProps ? (
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
              props={fullProps}
            />
          )}
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}

function isFullComposer(
  props: ChatComposerProps
): props is ChatComposerFullProps {
  return props.variant !== "minimal";
}

function resolveChatComposerLayout(
  props: ChatComposerProps,
  displayError: string | null,
  enableAddCommands = false
) {
  const isMinimal = props.variant === "minimal";
  const todos = props.todos ?? EMPTY_TODOS;
  const queuedMessages = props.queuedMessages ?? EMPTY_QUEUED_MESSAGES;
  const hasQueuedMessages = queuedMessages.length > 0;

  const showTodos = hasActiveAgentTodos(todos) && !displayError;

  const queueStackEdge: ComposerStackEdge = showTodos ? "continue" : "start";

  const availableSkills = isMinimal
    ? EMPTY_SKILLS
    : (props.availableSkills ?? EMPTY_SKILLS);

  return {
    availableSkills,
    disabled: props.disabled ?? false,
    enableAddCommands: !isMinimal && enableAddCommands,
    hasQueuedMessages,
    isMinimal,
    placeholder: props.placeholder ?? "Do anything...",
    queuedMessages,
    queueStackEdge,
    showOfflineHint: !isMinimal && props.showOfflineHint === true,
    showStacked: (showTodos || hasQueuedMessages) && !isMinimal,
    showTips: !isMinimal && props.showTips === true,
    showTodos,
    skillPickerKey: availableSkills.map((skill) => skill.id).join("\0"),
    todos,
  };
}

function ChatComposerMain({
  displayError,
  layout,
  onAddCommand,
  props,
  setAttachmentError,
}: {
  displayError: string | null;
  layout: ReturnType<typeof resolveChatComposerLayout>;
  onAddCommand: (action: ComposerAddCommandAction) => void;
  props: ChatComposerProps;
  setAttachmentError: (message: string | null) => void;
}) {
  const promptProps = {
    availableSkills: layout.availableSkills,
    busy: props.busy,
    canStop: props.canStop,
    chatStatus: props.chatStatus,
    disabled: layout.disabled,
    displayError,
    footerClassName: props.footerClassName,
    headerNotice: isFullComposer(props) ? props.headerNotice : undefined,
    onAddCommand: layout.enableAddCommands ? onAddCommand : undefined,
    onStop: props.onStop,
    onSubmit: props.onSubmit,
    placeholder: layout.placeholder,
    setAttachmentError,
    showTips: layout.showTips,
    skillPickerKey: layout.skillPickerKey,
  };

  if (layout.showStacked && isFullComposer(props)) {
    return (
      <div className="relative flex w-full flex-col">
        <ChatComposerWorkStack
          hasQueuedMessages={layout.hasQueuedMessages}
          queuedMessages={layout.queuedMessages}
          queueStackEdge={layout.queueStackEdge}
          showTodos={layout.showTodos}
          todos={layout.todos}
        />
        <div className="relative z-10 -mt-2 w-full">
          <ChatComposerStackedPrompt
            {...promptProps}
            primarySupportsVision={props.primarySupportsVision}
            props={props}
          />
        </div>
      </div>
    );
  }

  return (
    <ChatComposerBarePrompt
      {...promptProps}
      fullProps={isFullComposer(props) ? props : undefined}
      isMinimal={layout.isMinimal}
      primarySupportsVision={
        isFullComposer(props) ? props.primarySupportsVision : undefined
      }
    />
  );
}

const NO_OPEN_PLUGINS: ComposerOpenPlugin[] = [];

/** Enabled plugin pages whose tools or skills the agent has, for `/open`. */
function useAgentPluginViews(profileId: string | null): ComposerOpenPlugin[] {
  const plugins = useOrgPlugins();
  const profile = useProfileQuery(profileId);
  const enabled = Boolean(profileId);
  const tools = useToolsQuery({ enabled });
  const skills = useSkillsQuery({ enabled });

  if (!(profile.data && plugins.data && tools.data && skills.data)) {
    return NO_OPEN_PLUGINS;
  }

  const resources = { skills: skills.data, tools: tools.data };

  return enabledPluginNavEntries(plugins.data).flatMap(({ label, pluginId }) =>
    pluginAgentAccessState(profile.data, pluginId, resources).assigned > 0
      ? [{ label, pluginId }]
      : []
  );
}

/** Expand control for a plugin page in the side panel, like the artifact preview. */
function PluginPanelExpandButton({ panelId }: { panelId: string }) {
  const panel = useOptionalChatAttachmentPanel();
  const fullscreen = panel?.isFullscreen ?? false;

  return (
    <Button
      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() =>
        panel?.update(panelId, {
          fullscreen: !fullscreen,
          resizable: fullscreen,
        })
      }
      size="icon-sm"
      title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      type="button"
      variant="ghost"
    >
      {fullscreen ? (
        <ArrowShrink02Icon aria-hidden className="size-4" />
      ) : (
        <ArrowExpand01Icon aria-hidden className="size-4" />
      )}
    </Button>
  );
}

/** Plugin pages `/open` lists for the active agent, and how to show one. */
const OpenPluginContext = createContext<{
  /** Opens the add-plugin dialog. Null when the user cannot assign tools. */
  onAdd: (() => void) | null;
  open: (plugin: ComposerOpenPlugin) => void;
  plugins: ComposerOpenPlugin[];
}>({ onAdd: null, open: () => undefined, plugins: NO_OPEN_PLUGINS });

function composerBtwHandler(props: ChatComposerProps) {
  return isFullComposer(props) ? props.onBtw : undefined;
}

/** Opens the side chat for a sent `/btw …`. True when it did. */
function runBtwCommand(
  text: string,
  onBtw: ((question: string) => void) | undefined
): boolean {
  const question = onBtw ? matchComposerBtwCommand(text) : null;

  if (question === null) {
    return false;
  }

  onBtw?.(question);

  return true;
}

/** Agent whose MCP servers the + menu can switch, and how to add one. Null hides Connectors. */
const ConnectorsContext = createContext<{
  onAdd: () => void;
  profileId: string;
} | null>(null);

/** True when `/btw` is offered: only the composer that can open a side chat. */
const BtwCommandContext = createContext(false);

const CommandPrefixContext = createContext<{
  prefix: string | null;
  setPrefix: (prefix: string | null) => void;
}>({ prefix: null, setPrefix: () => undefined });

/** Strip above the input showing the selected leading command; its text lives outside the textarea. */
function ChatComposerCommandBanner({
  availableSkills,
}: {
  availableSkills: SkillSummary[];
}) {
  const { prefix, setPrefix } = useContext(CommandPrefixContext);
  const command = prefix ? getLeadingCommand(prefix, availableSkills) : null;

  if (!(prefix && command)) {
    return null;
  }

  return (
    <PromptInputHeader className="-mx-3 -mt-3 mb-1.5 w-auto flex-nowrap items-center gap-2 rounded-t-xl border-border border-b bg-muted/60 px-5 py-2 text-sm sm:-mx-3.5 sm:-mt-3.5">
      <span className="shrink-0 font-semibold text-foreground">{prefix}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {command.description}
      </span>
      <button
        aria-label="Remove command"
        className="shrink-0 rounded px-1 text-muted-foreground hover:text-foreground"
        onClick={() => setPrefix(null)}
        type="button"
      >
        ×
      </button>
    </PromptInputHeader>
  );
}

/** `/open` state for the composer: the agent's plugin pages, shown or hidden in the side panel. */
function useOpenPluginContext(profileId: string | null) {
  const panel = useOptionalChatAttachmentPanel();

  const openPlugins = useAgentPluginViews(panel ? profileId : null);

  return useMemo(
    () => ({
      open: (plugin: ComposerOpenPlugin) => {
        const id = `plugin:${plugin.pluginId}`;

        // A second /open for the same plugin closes it, like a toggle.
        if (panel?.activeId === id) {
          panel.hide(id);

          return;
        }

        panel?.show({
          bodyClassName: "flex flex-col overflow-hidden p-0",
          content: (
            <PluginView inlineHeaderActions pluginId={plugin.pluginId} />
          ),
          defaultWidth: 768,
          fullscreen: false,
          headerActions: <PluginPanelExpandButton panelId={id} />,
          id,
          resizable: true,
          title: plugin.label,
        });
      },
      plugins: openPlugins,
    }),
    [openPlugins, panel]
  );
}

export function ChatComposer(props: ChatComposerProps) {
  const { activeOrg, updateOrg, user } = useAuth();
  const { textInput } = usePromptInputController();

  const [addDialog, setAddDialog] = useState<ComposerAddCommandAction | null>(
    null
  );

  const [commandPrefix, setCommandPrefix] = useState<string | null>(null);

  const commandContext = useMemo(
    () => ({ prefix: commandPrefix, setPrefix: setCommandPrefix }),
    [commandPrefix]
  );

  useEffect(() => {
    storeComposerDraft(
      props.draftStorageKey ?? null,
      commandPrefix ? `${commandPrefix} ${textInput.value}` : textInput.value
    );
  }, [commandPrefix, props.draftStorageKey, textInput.value]);

  function clearDraft() {
    if (!props.draftStorageKey) {
      return;
    }

    storeComposerDraft(props.draftStorageKey, "");
    textInput.clear();
  }

  const openAddCommand = useCallback((action: ComposerAddCommandAction) => {
    setAddDialog(action);
  }, []);

  const openPluginContext = useOpenPluginContext(
    isFullComposer(props) ? (props.profileId ?? null) : null
  );

  const onBtw = composerBtwHandler(props);

  const canAddCapabilities =
    isFullComposer(props) &&
    Boolean(props.profileId) &&
    !(props.disabled ?? false) &&
    user?.isPlatformAdmin === true;

  const composerProps: ChatComposerProps = {
    ...props,
    onSubmit: (typedText, files) => {
      const text = commandPrefix
        ? `${commandPrefix} ${typedText}`.trim()
        : typedText;

      setCommandPrefix(null);

      if (runBtwCommand(text, onBtw)) {
        clearDraft();

        return;
      }

      const openCommand = matchComposerOpenCommand(
        text,
        openPluginContext.plugins
      );

      if (openCommand) {
        clearDraft();
        openPluginContext.open(openCommand);

        return;
      }

      if (matchComposerLearningLoopCommand(text)) {
        clearDraft();

        if (!activeOrg) {
          toast("Select an organization before enabling the learning loop.");

          return;
        }

        void updateOrg(activeOrg.id, { skillsPostTurnReview: true })
          .then(() => toast("Learning loop activated."))
          .catch((error) => toast(formatError(error)));

        return;
      }

      const addCommand = canAddCapabilities
        ? matchComposerAddCommand(text)
        : null;

      if (addCommand) {
        clearDraft();
        openAddCommand(addCommand);

        return;
      }

      clearDraft();
      props.onSubmit(text, files);
    },
  };

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const displayError = props.error ?? attachmentError;

  const layout = resolveChatComposerLayout(
    composerProps,
    displayError,
    canAddCapabilities
  );

  const addProfileId =
    isFullComposer(composerProps) && layout.enableAddCommands
      ? (composerProps.profileId ?? null)
      : null;

  const connectorsContext = useMemo(
    () =>
      addProfileId
        ? { onAdd: () => openAddCommand("add-mcp"), profileId: addProfileId }
        : null,
    [addProfileId, openAddCommand]
  );

  const pluginsMenuContext = useMemo(
    () => ({
      ...openPluginContext,
      onAdd: addProfileId ? () => openAddCommand("add-plugin") : null,
    }),
    [addProfileId, openAddCommand, openPluginContext]
  );

  return (
    <CommandPrefixContext.Provider value={commandContext}>
      <BtwCommandContext.Provider value={Boolean(onBtw)}>
        <OpenPluginContext.Provider value={pluginsMenuContext}>
          <ConnectorsContext.Provider value={connectorsContext}>
            <div className={cn("w-full shrink-0", props.className)}>
              {layout.showOfflineHint && isFullComposer(props) ? (
                <ChatComposerOfflineHint
                  onConnectProvider={props.onConnectProvider}
                />
              ) : null}
              <ChatComposerMain
                displayError={displayError}
                layout={layout}
                onAddCommand={openAddCommand}
                props={composerProps}
                setAttachmentError={setAttachmentError}
              />
              {addProfileId ? (
                <ChatAddCapabilitiesDialogs
                  mcpOpen={addDialog === "add-mcp"}
                  onMcpOpenChange={(open) => {
                    setAddDialog(open ? "add-mcp" : null);
                  }}
                  onPluginOpenChange={(open) =>
                    setAddDialog(open ? "add-plugin" : null)
                  }
                  onSkillOpenChange={(open) => {
                    setAddDialog(open ? "add-skill" : null);
                  }}
                  onToolOpenChange={(open) => {
                    setAddDialog(open ? "add-tool" : null);
                  }}
                  pluginOpen={addDialog === "add-plugin"}
                  profileId={addProfileId}
                  skillOpen={addDialog === "add-skill"}
                  toolOpen={addDialog === "add-tool"}
                />
              ) : null}
            </div>
          </ConnectorsContext.Provider>
        </OpenPluginContext.Provider>
      </BtwCommandContext.Provider>
    </CommandPrefixContext.Provider>
  );
}

function ChatComposerTextarea({
  availableSkills,
  disabled,
  className,
  onAddCommand,
  placeholder,
  longPasteWordThreshold,
}: {
  availableSkills: SkillSummary[];
  disabled: boolean;
  className: string;
  onAddCommand?: (action: ComposerAddCommandAction) => void;
  placeholder: string;
  longPasteWordThreshold?: number;
}) {
  const controller = usePromptInputController();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [slashRange, setSlashRange] = useState<SkillSlashRange | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const openPlugin = useContext(OpenPluginContext);
  const enableBtw = useContext(BtwCommandContext);

  const mentionOpen =
    slashRange !== null && controller.textInput.value[slashRange.start] === "@";

  const suggestions = useMemo(() => {
    if (!slashRange) {
      return [];
    }

    return mentionOpen
      ? filterComposerMentionSuggestions(slashRange.query)
      : filterComposerSlashSuggestions(availableSkills, slashRange.query, {
          enableAddCommands: onAddCommand != null,
          enableBtw,
          openPlugins: openPlugin.plugins,
        });
  }, [
    availableSkills,
    enableBtw,
    mentionOpen,
    onAddCommand,
    openPlugin.plugins,
    slashRange,
  ]);

  const pickerOpen = Boolean(slashRange && !disabled && suggestions.length > 0);

  const safeActiveIndex =
    suggestions.length === 0
      ? 0
      : Math.min(activeIndex, suggestions.length - 1);

  const updateSlashRange = useCallback((value: string, cursorIndex: number) => {
    setSlashRange(
      findActiveSkillSlashRange(value, cursorIndex) ??
        findActiveSkillSlashRange(value, cursorIndex, "@")
    );
    setActiveIndex(0);
  }, []);

  const selectSuggestion = useCallback(
    (suggestion: ComposerSuggestion) => {
      const textarea = textareaRef.current;
      const value = controller.textInput.value;
      const cursorIndex = textarea?.selectionStart ?? value.length;

      const activeRange =
        slashRange ??
        findActiveSkillSlashRange(
          value,
          cursorIndex,
          suggestion.kind === "mention" ? "@" : "/"
        );

      if (!activeRange) {
        return;
      }

      if (suggestion.kind === "plugin") {
        controller.textInput.setInput(
          `${value.slice(0, activeRange.start)}${value.slice(activeRange.end)}`
        );
        setSlashRange(null);
        setActiveIndex(0);
        openPlugin.open(suggestion.plugin);

        return;
      }

      const addAction =
        suggestion.kind === "command" ? suggestion.command.action : undefined;

      if (
        onAddCommand &&
        (addAction === "add-tool" ||
          addAction === "add-mcp" ||
          addAction === "add-plugin" ||
          addAction === "add-skill")
      ) {
        controller.textInput.setInput(
          `${value.slice(0, activeRange.start)}${value.slice(activeRange.end)}`
        );
        setSlashRange(null);
        setActiveIndex(0);
        onAddCommand(addAction);

        return;
      }

      const next =
        suggestion.kind === "skill"
          ? replaceSlashRangeWithSkillInvocation(
              value,
              activeRange,
              suggestion.skill
            )
          : suggestion.kind === "mention"
            ? replaceSlashRangeWithReservedCommand(
                value,
                activeRange,
                suggestion.mention,
                "@"
              )
            : replaceSlashRangeWithReservedCommand(
                value,
                activeRange,
                suggestion.command
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
    [controller.textInput, onAddCommand, openPlugin, slashRange]
  );

  const { prefix, setPrefix } = useContext(CommandPrefixContext);
  const value = controller.textInput.value;
  const setInput = controller.textInput.setInput;

  // Move a finished leading command (`/learn `, `/skill name `) out of the text.
  useEffect(() => {
    const command = getLeadingCommand(value, availableSkills);
    const next = command ? value[command.range.end] : undefined;

    if (!(command && next && /\s/.test(next))) {
      return;
    }

    setPrefix(value.slice(command.range.start, command.range.end));
    setInput(value.slice(command.range.end).replace(/^[ \t]/, ""));
  }, [availableSkills, setInput, setPrefix, value]);

  return (
    <div className="relative min-w-0 flex-1">
      <ChatSkillTokenOverlay
        className={className}
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
            if (event.key === "Escape" && prefix) {
              event.preventDefault();
              setPrefix(null);
            }

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

          if (
            (event.key === "Enter" || event.key === "Tab") &&
            !event.shiftKey
          ) {
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

function resolveModelPickerState(props: ChatComposerFullProps) {
  const effortOptions = props.thinkingEffortOptions ?? THINKING_EFFORT_OPTIONS;

  const effort =
    props.thinkingEffortVisible &&
    props.thinkingEffort &&
    props.onThinkingEffortChange
      ? props.thinkingEffort
      : null;

  const effortLabel = effort
    ? shortEffortLabel(
        effort,
        effortOptions.find((option) => option.value === effort)?.label ?? effort
      )
    : null;

  const modelLabel = props.currentModelSelection
    ? (props.renderModelLabel(props.currentModelSelection) ?? "Model")
    : "Model";

  return {
    effort,
    effortOptions,
    hasModels: props.providerModelGroups.some(
      (group) => group.models.length > 0
    ),
    showProfileModel:
      Boolean(props.profileModelId) &&
      !props.providerModelGroups.some((group) =>
        group.models.some((model) => model.id === props.profileModelId)
      ),
    triggerLabel: effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel,
  };
}

function ChatModelEffortRow({
  disabled,
  effort,
  onEffortChange,
  options,
}: {
  disabled?: boolean;
  effort: string;
  onEffortChange?: (effort: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-border/60 border-t p-2 pl-3">
      <span aria-hidden className="font-medium text-muted-foreground text-xs">
        Thinking effort
      </span>
      <fieldset className="flex gap-0.5 rounded-lg bg-muted p-0.5">
        <legend className="sr-only">Thinking effort</legend>
        {options.map((option) => (
          <button
            aria-pressed={option.value === effort}
            className={cn(
              "h-7 rounded-md px-2.5 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
              option.value === effort &&
                "bg-background text-foreground shadow-xs"
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onEffortChange?.(option.value)}
            type="button"
          >
            {shortEffortLabel(option.value, option.label)}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function ChatModelPicker({
  props,
  busy,
  disabled,
}: {
  props: ChatComposerFullProps;
  busy: boolean;
  disabled: boolean;
}) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [showModelSearch, setShowModelSearch] = useState(false);
  const [modelList, setModelList] = useState<HTMLDivElement | null>(null);

  const closeModelPicker = () => {
    setModelPickerOpen(false);
    setModelSearch("");
    setShowModelSearch(false);
  };

  const selectModel = (value: string) => {
    void props.onModelChange(value);
    closeModelPicker();
  };

  const { effort, effortOptions, hasModels, showProfileModel, triggerLabel } =
    resolveModelPickerState(props);

  useEffect(() => {
    if (!(modelPickerOpen && modelList)) {
      return;
    }

    const showSearchForOverflow = () => {
      if (modelList.scrollHeight > modelList.clientHeight + 1) {
        setShowModelSearch(true);
      }
    };

    const observer = new ResizeObserver(showSearchForOverflow);
    observer.observe(modelList);

    if (modelList.firstElementChild) {
      observer.observe(modelList.firstElementChild);
    }

    showSearchForOverflow();

    return () => observer.disconnect();
  }, [modelPickerOpen, modelList]);

  return (
    <div className="min-w-[4.5rem] shrink overflow-hidden">
      <Popover
        onOpenChange={(open) => {
          if (open) {
            setModelPickerOpen(true);
          } else {
            closeModelPicker();
          }
        }}
        open={modelPickerOpen}
      >
        <PopoverTrigger
          aria-label="Select model and effort"
          className="flex h-7 max-w-full items-center overflow-hidden rounded-full bg-muted px-2.5 font-medium text-foreground text-xs transition-[background-color,opacity] hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-accent"
          disabled={disabled || !(hasModels || effort)}
          title={triggerLabel}
          type="button"
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-w-[min(24rem,92vw)] overflow-hidden p-0"
        >
          <Command className="rounded-lg bg-transparent p-0">
            {showModelSearch ? (
              <div className="border-border/60 border-b p-2 [&_[data-slot=command-input-wrapper]]:p-0">
                <CommandInput
                  aria-label="Search models"
                  autoFocus
                  onValueChange={setModelSearch}
                  placeholder="Search models…"
                  value={modelSearch}
                />
              </div>
            ) : null}
            <CommandList className="max-h-72 p-1" ref={setModelList}>
              <CommandEmpty>No model found.</CommandEmpty>
              {showProfileModel && props.profileModelId ? (
                <CommandItem
                  data-checked={
                    props.currentModelSelection ===
                    encodeModelSelection("__unknown__", props.profileModelId)
                  }
                  disabled={busy}
                  onSelect={() =>
                    selectModel(
                      encodeModelSelection("__unknown__", props.profileModelId!)
                    )
                  }
                  value={props.profileModelId}
                >
                  {props.profileModelId}
                </CommandItem>
              ) : null}
              {props.providerModelGroups.map((group) => (
                <CommandGroup
                  heading={group.providerLabel}
                  key={group.providerId}
                >
                  {group.models.map((model) => {
                    const providerId = model.providerId ?? group.providerId;
                    const value = encodeModelSelection(providerId, model.id);

                    return (
                      <CommandItem
                        data-checked={props.currentModelSelection === value}
                        disabled={busy}
                        key={`${providerId}:${model.id}`}
                        onSelect={() => selectModel(value)}
                        value={`${group.providerLabel} ${model.name} ${model.id}`}
                      >
                        {model.name}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          {effort ? (
            <ChatModelEffortRow
              disabled={props.thinkingEffortDisabled}
              effort={effort}
              onEffortChange={props.onThinkingEffortChange}
              options={effortOptions}
            />
          ) : null}
        </PopoverContent>
      </Popover>
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
        <ChatAttachmentButton disabled={disabled} />

        {props.providerConfigured ? (
          <ChatModelPicker busy={busy} disabled={disabled} props={props} />
        ) : (
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-3 font-medium text-amber-800 text-sm dark:text-amber-200">
            <WifiOff01Icon aria-hidden className="size-3.5 shrink-0" />
            Offline
          </span>
        )}
      </div>

      <div
        aria-label="Composer actions"
        className="ml-auto flex shrink-0 items-center gap-1.5"
        role="toolbar"
      >
        {props.contextUsage ? (
          <ChatContextUsageRing
            sessionUsage={props.sessionUsage}
            usage={props.contextUsage}
          />
        ) : null}

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

/** Visible 32px face; ≥40px hit via pseudo. Keep transform in transition for press scale. */
const composerSubmitButtonClassName = cn(
  composerHitTargetClass,
  "size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-[color,background-color,transform,opacity] hover:bg-primary/90 active:scale-[0.96] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
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
  const { prefix: commandPrefix } = useContext(CommandPrefixContext);

  const hasContent =
    controller.textInput.value.trim().length > 0 ||
    commandPrefix !== null ||
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
          <ArrowUp02Icon className="size-4" />
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
        <ArrowUp02Icon className="size-4" />
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

  const addFolder = (picked: FileList | null) => {
    const selection = selectFolderFiles([...(picked ?? [])]);

    if (selection.ok) {
      attachments.add(selection.files);
    } else if (picked && picked.length > 0) {
      toast(selection.error);
    }
  };

  // Built on demand: a rendered input here makes the + menu close on focus-out.
  const openFolderPicker = () => {
    const input = document.createElement("input");

    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.addEventListener("change", () => addFolder(input.files), {
      once: true,
    });
    input.click();
  };

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
                  className={cn(
                    composerIconButtonClass,
                    "size-8 bg-transparent text-foreground hover:bg-muted"
                  )}
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Add01Icon className="size-4" />
                </Button>
              }
            />
          }
        />
        <TooltipContent side="top">Add attachment</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-40">
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
        <DropdownMenuItem disabled={disabled} onClick={openFolderPicker}>
          <Folder01Icon aria-hidden className="size-4 text-muted-foreground" />
          Add folder
        </DropdownMenuItem>
        <ChatPluginsSubmenu disabled={disabled} />
        <ChatConnectorsSubmenu disabled={disabled} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** + menu submenu: open one of the agent's plugin pages, or add a plugin. */
function ChatPluginsSubmenu({ disabled }: { disabled: boolean }) {
  const { onAdd, open, plugins } = useContext(OpenPluginContext);

  if (plugins.length === 0 && !onAdd) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <PuzzleIcon aria-hidden className="size-4 text-muted-foreground" />
        Plugins
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        {onAdd ? (
          <DropdownMenuItem onClick={onAdd}>
            <Add01Icon aria-hidden className="size-4 text-muted-foreground" />
            Add plugin
          </DropdownMenuItem>
        ) : null}
        {onAdd && plugins.length > 0 ? <DropdownMenuSeparator /> : null}
        {plugins.map((plugin) => (
          <DropdownMenuItem key={plugin.pluginId} onClick={() => open(plugin)}>
            {plugin.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** + menu submenu: switch org MCP servers on or off for the chat's agent. */
function ChatConnectorsSubmenu({ disabled }: { disabled: boolean }) {
  const connectors = useContext(ConnectorsContext);

  return connectors ? (
    <ChatConnectorsSubmenuItems
      disabled={disabled}
      onAdd={connectors.onAdd}
      profileId={connectors.profileId}
    />
  ) : null;
}

function ChatConnectorsSubmenuItems({
  disabled,
  onAdd,
  profileId,
}: {
  disabled: boolean;
  onAdd: () => void;
  profileId: string;
}) {
  const navigate = useNavigate();
  const servers = useMcpServersQuery();
  const profile = useProfileQuery(profileId);
  const assign = useAssignMcpServerMutation();
  const unassign = useUnassignMcpServerMutation();

  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  );

  const assignedIds = new Set(
    profile.data?.mcpServers.map((server) => server.id) ?? []
  );

  const toggle = (serverId: string, on: boolean) => {
    setPending((current) => new Map(current).set(serverId, on));

    const mutation = on ? assign : unassign;

    mutation
      .mutateAsync({ profileId, serverId })
      .catch((error) => toast(formatError(error)))
      .finally(() =>
        setPending((current) => {
          const next = new Map(current);

          next.delete(serverId);

          return next;
        })
      );
  };

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>
          <Plug01Icon aria-hidden className="size-4 text-muted-foreground" />
          Connectors
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56">
          <DropdownMenuItem
            onClick={() => navigate(profilePath(profileId, { section: "mcp" }))}
          >
            <Settings01Icon
              aria-hidden
              className="size-4 text-muted-foreground"
            />
            Manage connectors
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAdd}>
            <Add01Icon aria-hidden className="size-4 text-muted-foreground" />
            Add connector
          </DropdownMenuItem>
          {servers.data && servers.data.length > 0 ? (
            <DropdownMenuSeparator />
          ) : null}
          {servers.data?.map((server) => {
            const saving = pending.has(server.id);

            const checked =
              pending.get(server.id) ?? assignedIds.has(server.id);

            return (
              <DropdownMenuCheckboxItem
                checked={checked}
                closeOnClick={false}
                disabled={saving || !profile.data}
                key={server.id}
                onCheckedChange={(next) => toggle(server.id, next)}
              >
                <span className="min-w-0 flex-1 truncate">{server.name}</span>
                {saving ? (
                  <Spinner className="size-3.5 text-muted-foreground" />
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors",
                    checked ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                >
                  <span
                    className={cn(
                      "block size-3.5 rounded-full bg-background shadow-sm transition-transform",
                      checked ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

function StopIcon() {
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-[3px] bg-current"
    />
  );
}
