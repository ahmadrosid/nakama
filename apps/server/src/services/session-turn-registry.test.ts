import { describe, expect, test } from "bun:test";
import type { AgentTodo, StreamEvent } from "@nakama/core";
import { SessionTurnRegistry } from "./session-turn-registry";

describe("SessionTurnRegistry", () => {
  test("beginTurn starts once and rejects concurrent begin", () => {
    const registry = new SessionTurnRegistry();

    expect(registry.beginTurn("session_1")).toEqual({ started: true });
    expect(registry.beginTurn("session_1")).toEqual({ started: false });
    expect(registry.getStatus("session_1")).toEqual({
      active: true,
      startedAt: expect.any(String),
    });
  });

  test("subscribe receives replay then live events", async () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");
    registry.publish("session_1", { delta: "hello", type: "chunk" });
    registry.publish("session_1", { delta: " world", type: "chunk" });

    const received: string[] = [];
    const handle = registry.subscribe("session_1", (event) => {
      if (event.type === "chunk") {
        received.push(event.delta);
      }
    });

    expect(handle).not.toBeNull();
    expect(received).toEqual(["hello", " world"]);

    registry.publish("session_1", { delta: "!", type: "chunk" });
    expect(received).toEqual(["hello", " world", "!"]);

    registry.endTurn("session_1", { reply: "hello world!", type: "done" });
    expect(registry.getStatus("session_1")).toEqual({ active: false });
  });

  test("replacing a todo snapshot preserves tool lifecycle order on replay", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");

    const live: StreamEvent[] = [];
    registry.subscribe("session_1", (event) => live.push(event));

    const todos: AgentTodo[] = [
      { content: "Read files", id: "todo_1", status: "in_progress" },
    ];
    const events: StreamEvent[] = [
      { todos: [], type: "todos_updated" },
      {
        input: { todos },
        tool: "todo_write",
        toolCallId: "call_1",
        type: "tool_start",
      },
      {
        result: { todos },
        tool: "todo_write",
        toolCallId: "call_1",
        type: "tool_end",
      },
      { todos, type: "todos_updated" },
    ];
    for (const event of events) {
      registry.publish("session_1", event);
    }

    const replay: StreamEvent[] = [];
    registry.subscribe("session_1", (event) => replay.push(event));

    expect(live).toEqual(events);
    expect(replay).toEqual(events.slice(1));

    const chunk: StreamEvent = { delta: "Done", type: "chunk" };
    registry.publish("session_1", chunk);
    expect(live).toEqual([...events, chunk]);
    expect(replay).toEqual([...events.slice(1), chunk]);
  });

  test("replays the latest interleaved tool inputs in publication order", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");

    const first: StreamEvent = {
      accumulatedArguments: "{",
      delta: "{",
      tool: "read_file",
      toolCallId: "call_1",
      type: "tool_input_delta",
    };
    const second: StreamEvent = { ...first, toolCallId: "call_2" };
    const chunk: StreamEvent = { delta: "Reading files", type: "chunk" };
    const firstUpdated: StreamEvent = {
      ...first,
      accumulatedArguments: '{"path":"a.txt"}',
      delta: '"path":"a.txt"}',
    };
    const secondUpdated: StreamEvent = {
      ...second,
      accumulatedArguments: '{"path":',
      delta: '"path":',
    };
    const secondComplete: StreamEvent = {
      ...second,
      accumulatedArguments: '{"path":"b.txt"}',
      delta: '"b.txt"}',
    };

    for (const event of [
      first,
      second,
      chunk,
      firstUpdated,
      secondUpdated,
      secondComplete,
    ]) {
      registry.publish("session_1", event);
    }

    const replay: StreamEvent[] = [];
    registry.subscribe("session_1", (event) => replay.push(event));

    expect(replay).toEqual([chunk, firstUpdated, secondComplete]);
  });

  test("multiple subscribers each receive replay and live events", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");
    registry.publish("session_1", { delta: "hmm", type: "thinking" });

    const first: string[] = [];
    const second: string[] = [];

    registry.subscribe("session_1", (event) => {
      if (event.type === "thinking") {
        first.push(event.delta);
      }
    });
    registry.subscribe("session_1", (event) => {
      if (event.type === "thinking") {
        second.push(event.delta);
      }
    });

    registry.publish("session_1", { delta: "...", type: "thinking" });

    expect(first).toEqual(["hmm", "..."]);
    expect(second).toEqual(["hmm", "..."]);
  });

  test("endTurn clears state and later subscribe returns null", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");
    registry.endTurn("session_1", { reply: "ok", type: "done" });

    expect(registry.subscribe("session_1", () => {})).toBeNull();
    expect(registry.getStatus("session_1")).toEqual({ active: false });
  });

  test("cancelTurn releases a reservation without a terminal event", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");

    registry.cancelTurn("session_1");

    expect(registry.subscribe("session_1", () => {})).toBeNull();
    expect(registry.beginTurn("session_1")).toEqual({ started: true });
  });

  test("retains latest accumulatedArguments per toolCallId under buffer pressure", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");

    for (let index = 0; index < 12_000; index += 1) {
      registry.publish("session_1", {
        accumulatedArguments: `{"path":"a.txt","content":"${index}"}`,
        delta: "x",
        tool: "write_file",
        toolCallId: "call_1",
        type: "tool_input_delta",
      });
    }

    const replay: string[] = [];
    registry.subscribe("session_1", (event) => {
      if (event.type === "tool_input_delta" && event.toolCallId === "call_1") {
        replay.push(event.accumulatedArguments ?? event.delta);
      }
    });

    expect(replay.length).toBeGreaterThan(0);
    expect(replay[replay.length - 1]).toContain("11999");
  });
});
