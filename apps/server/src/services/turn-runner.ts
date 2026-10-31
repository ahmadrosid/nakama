import type { AgentChatSession } from "@nakama/agent";
import {
  type ChatContextUsage,
  type ChatTurnUsage,
  formatServerError,
  NakamaApiError,
  reportError,
  resolveChatFirstTokenTimeoutMs,
  resolveChatStreamTimeoutMs,
  type SendMessageInput,
  type StreamEvent,
  type ToolContext,
} from "@nakama/core";
import type { StoredSessionRecord } from "@nakama/db";
import { z } from "zod";
import { sessionKind } from "./session-runtime";
import {
  type SessionTurnRegistry,
  sessionTurnRegistry,
} from "./session-turn-registry";

/** How a turn ended. `status` is the HTTP status a JSON reply answers with. */
export type TurnEnd =
  | {
      contextUsage?: ChatContextUsage;
      kind: "done";
      reply: string;
      usage?: ChatTurnUsage;
    }
  | {
      kind: "error";
      message: string;
      /** `stalled`: the provider sent nothing before the first-token deadline. */
      reason: "cancelled" | "failed" | "stalled" | "timeout";
      status: number;
      usage?: ChatTurnUsage;
    };

/** The part of a chat a turn uses. */
export type TurnChat = Pick<
  AgentChatSession,
  "getContextUsage" | "getTurnUsage" | "sendStream"
>;

export type TurnStart =
  | { status: "busy" }
  | { status: "not_found" }
  | { done: Promise<TurnEnd>; status: "started" };

export interface TurnOptions {
  /** Every event of the turn, in order, ending with `done` or `error`. */
  onEvent?(event: StreamEvent): void;
  /** Aborting it stops the turn, as a closed tab or a stopped parent does. */
  signal?: AbortSignal;
  timeoutMs?: number;
  whatsappMessage?: ToolContext["whatsappMessage"];
}

export interface TurnRunnerDeps {
  firstTokenTimeoutMs?: number;
  /** Null when the session is missing or belongs to another org. */
  loadRecord(
    sessionId: string,
    orgId: string
  ): Promise<StoredSessionRecord | null>;
  /** Runs once the turn holds the lock, before the chat is fetched. */
  prepare(record: StoredSessionRecord, orgId: string): Promise<void>;
  registry?: SessionTurnRegistry;
  reportError?: typeof reportError;
  scheduleSkillReview(sessionId: string): void;
  scheduleTitle(sessionId: string): void;
  sessions: {
    get(sessionId: string, orgId: string): Promise<TurnChat | null>;
  };
  timeoutMs?: number;
}

const agentTodoResultSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string(),
      id: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    })
  ),
});

const questionnaireResultSchema = z.object({
  questionnaire: z.object({
    id: z.string(),
    questions: z.array(
      z.object({
        allowCustomAnswer: z.boolean(),
        choices: z.array(z.object({ id: z.string(), label: z.string() })),
        id: z.string(),
        placeholder: z.string().optional(),
        prompt: z.string(),
      })
    ),
    title: z.string(),
  }),
});

/** Maps chat callbacks to stream events. */
function agentHandlers(
  send: (event: StreamEvent) => void
): Parameters<TurnChat["sendStream"]>[1] {
  return {
    onChunk: (delta) => send({ delta, type: "chunk" }),
    onSubAgentActivity: (event) =>
      send({
        label: event.label,
        parentToolCallId: event.parentToolCallId,
        type: "sub_agent_activity",
      }),
    onThinking: (delta) => send({ delta, type: "thinking" }),
    onToolEnd: (event) => {
      send({
        images: event.images,
        result: event.result,
        tool: event.tool,
        toolCallId: event.toolCallId,
        toolGroupId: event.toolGroupId,
        type: "tool_end",
      });

      if (event.tool === "todo_write") {
        const parsed = agentTodoResultSchema.safeParse(event.result);

        if (parsed.success) {
          send({ todos: parsed.data.todos, type: "todos_updated" });
        }
      }

      if (event.tool === "ask_user_question") {
        const parsed = questionnaireResultSchema.safeParse(event.result);

        if (parsed.success) {
          send({
            questionnaire: parsed.data.questionnaire,
            type: "questionnaire_updated",
          });
        }
      }
    },
    onToolInputDelta: (event) =>
      send({
        accumulatedArguments: event.accumulatedArguments,
        delta: event.delta,
        tool: event.tool,
        toolCallId: event.toolCallId,
        toolGroupId: event.toolGroupId,
        type: "tool_input_delta",
      }),
    onToolStart: (event) =>
      send({
        input: event.input,
        tool: event.tool,
        toolCallId: event.toolCallId,
        toolGroupId: event.toolGroupId,
        type: "tool_start",
      }),
    onUsage: (usage) => send({ type: "usage", usage }),
  };
}

/** What a turn ends with when it was stopped rather than failed. */
export const TURN_CANCELLED_ERROR = "Turn cancelled.";

/** The `done` or `error` event a turn end is shown as. */
export function terminalEvent(end: TurnEnd): StreamEvent {
  if (end.kind === "done") {
    const event: Extract<StreamEvent, { type: "done" }> = {
      reply: end.reply,
      type: "done",
    };

    if (end.contextUsage) {
      event.contextUsage = end.contextUsage;
    }

    if (end.usage) {
      event.usage = end.usage;
    }

    return event;
  }

  const event: Extract<StreamEvent, { type: "error" }> = {
    error: end.message,
    type: "error",
  };

  if (end.usage) {
    event.usage = end.usage;
  }

  return event;
}

function cancelledEnd(usage?: ChatTurnUsage): TurnEnd {
  return {
    kind: "error",
    message: TURN_CANCELLED_ERROR,
    reason: "cancelled",
    status: 499,
    usage,
  };
}

/**
 * Runs one turn of a session from lock to post-turn work. Callers only choose
 * how to show it: an SSE stream, a JSON reply, or a sub-agent result.
 */
export class TurnRunner {
  private readonly firstTokenTimeoutMs: number;
  private readonly registry: SessionTurnRegistry;
  private readonly report: typeof reportError;
  private readonly timeoutMs: number;

  constructor(private readonly deps: TurnRunnerDeps) {
    this.firstTokenTimeoutMs =
      deps.firstTokenTimeoutMs ?? resolveChatFirstTokenTimeoutMs();
    this.registry = deps.registry ?? sessionTurnRegistry;
    this.report = deps.reportError ?? reportError;
    this.timeoutMs = deps.timeoutMs ?? resolveChatStreamTimeoutMs();
  }

  /**
   * Takes the session's turn and starts it. The record is checked before the
   * lock, so a busy session in another org still answers not_found.
   */
  async start(
    sessionId: string,
    orgId: string,
    input: SendMessageInput,
    options: TurnOptions = {}
  ): Promise<TurnStart> {
    const record = await this.deps.loadRecord(sessionId, orgId);

    if (!record) {
      return { status: "not_found" };
    }

    if (!this.registry.beginTurn(sessionId).started) {
      return { status: "busy" };
    }

    // Attached before prepare, so a stop or close_session sent while the chat
    // is prepared still reaches the turn.
    const abort = new AbortController();
    this.registry.attachAbort(sessionId, abort);

    let chat: TurnChat | null;

    try {
      await this.deps.prepare(record, orgId);
      chat = await this.deps.sessions.get(sessionId, orgId);
    } catch (error) {
      this.registry.cancelTurn(sessionId);
      throw error;
    }

    if (!chat) {
      this.registry.cancelTurn(sessionId);

      return { status: "not_found" };
    }

    return {
      done: this.run(record, chat, input, options, abort),
      status: "started",
    };
  }

  private async run(
    record: StoredSessionRecord,
    chat: TurnChat,
    input: SendMessageInput,
    options: TurnOptions,
    abort: AbortController
  ): Promise<TurnEnd> {
    const sessionId = record.id;

    const signal = options.signal
      ? AbortSignal.any([abort.signal, options.signal])
      : abort.signal;

    const send = (event: StreamEvent) => {
      this.registry.publish(sessionId, event);

      try {
        options.onEvent?.(event);
      } catch {
        // A caller that cannot show an event must not end the turn.
      }
    };

    // The caller left while the chat was being prepared. Sending now would
    // still write the message into history, so the turn ends untouched.
    if (signal.aborted) {
      const cancelled = cancelledEnd();

      this.finish(sessionId, cancelled, send);

      return cancelled;
    }

    // Anything the provider produces clears the first-token deadline.
    let sawOutput = false;
    // A deadline aborts the turn too, so the signal alone cannot tell a
    // cancel from a timeout.
    let timedOut: "stalled" | "timeout" | null = null;
    const deadlines: ReturnType<typeof setTimeout>[] = [];

    const failAfter = (
      ms: number,
      message: string,
      reason: "stalled" | "timeout",
      when?: () => boolean
    ) =>
      new Promise<never>((_, reject) => {
        deadlines.push(
          setTimeout(() => {
            if (when && !when()) {
              return;
            }

            timedOut = reason;
            reject(new NakamaApiError(message, 504));
            // After rejecting, so the race reports the timeout and not the
            // abort. Nothing else stops the open provider request.
            abort.abort();
          }, ms)
        );
      });

    let end: TurnEnd;

    try {
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;

      const raced: Promise<string>[] = [
        chat.sendStream(
          input,
          agentHandlers((event) => {
            sawOutput = true;
            send(event);
          }),
          { signal, whatsappMessage: options.whatsappMessage }
        ),
        failAfter(
          timeoutMs,
          `Chat timed out after ${Math.round(timeoutMs / 1000)}s waiting for the provider. Try another model or check provider settings.`,
          "timeout"
        ),
      ];

      if (this.firstTokenTimeoutMs > 0) {
        raced.push(
          failAfter(
            this.firstTokenTimeoutMs,
            `The provider accepted the request but sent nothing for ${Math.round(this.firstTokenTimeoutMs / 1000)}s. Try another model or check provider settings.`,
            "stalled",
            () => !sawOutput
          )
        );
      }

      const reply = await Promise.race(raced);

      end = {
        contextUsage: chat.getContextUsage() ?? undefined,
        kind: "done",
        reply,
        usage: chat.getTurnUsage() ?? undefined,
      };
    } catch (error) {
      const cancelled = signal.aborted && timedOut === null;

      // A 504 timeout is exactly what an operator needs, so only a 4xx
      // refusal and a cancel go unreported.
      if (
        !(cancelled || (error instanceof NakamaApiError && error.status < 500))
      ) {
        void this.report(error, { kind: "turn", source: "server" });
      }

      // The provider charged for the calls that landed. Guarded because a
      // throw here would replace the real failure with a blank one.
      let usage: ChatTurnUsage | undefined;

      try {
        usage = chat.getTurnUsage() ?? undefined;
      } catch {
        usage = undefined;
      }

      end = cancelled
        ? cancelledEnd(usage)
        : {
            kind: "error",
            message: formatServerError(error),
            reason: timedOut ?? "failed",
            status: error instanceof NakamaApiError ? error.status : 500,
            usage,
          };
    } finally {
      for (const handle of deadlines) {
        clearTimeout(handle);
      }
    }

    this.finish(sessionId, end, send);

    // The turn is over and its lock is free; a failing hook must not turn a
    // finished reply into an error or an unhandled rejection.
    try {
      this.deps.scheduleTitle(sessionId);

      if (end.kind === "done" && sessionKind(record) !== "child") {
        this.deps.scheduleSkillReview(sessionId);
      }
    } catch (error) {
      void this.report(error, { kind: "turn", source: "server" });
    }

    return end;
  }

  /** Sends the last event and frees the lock, even when sending fails. */
  private finish(
    sessionId: string,
    end: TurnEnd,
    send: (event: StreamEvent) => void
  ): void {
    const terminal = terminalEvent(end);

    try {
      send(terminal);
    } catch (error) {
      void this.report(error, { kind: "turn", source: "server" });
    } finally {
      this.registry.endTurn(sessionId, terminal);
    }
  }
}
