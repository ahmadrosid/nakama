import { describe, expect, test } from "bun:test";
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
