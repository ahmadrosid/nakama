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
    registry.publish("session_1", { type: "chunk", delta: "hello" });
    registry.publish("session_1", { type: "chunk", delta: " world" });

    const received: string[] = [];
    const handle = registry.subscribe("session_1", (event) => {
      if (event.type === "chunk") {
        received.push(event.delta);
      }
    });

    expect(handle).not.toBeNull();
    expect(received).toEqual(["hello", " world"]);

    registry.publish("session_1", { type: "chunk", delta: "!" });
    expect(received).toEqual(["hello", " world", "!"]);

    registry.endTurn("session_1", { type: "done", reply: "hello world!" });
    expect(registry.getStatus("session_1")).toEqual({ active: false });
  });

  test("multiple subscribers each receive replay and live events", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");
    registry.publish("session_1", { type: "thinking", delta: "hmm" });

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

    registry.publish("session_1", { type: "thinking", delta: "..." });

    expect(first).toEqual(["hmm", "..."]);
    expect(second).toEqual(["hmm", "..."]);
  });

  test("endTurn clears state and later subscribe returns null", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");
    registry.endTurn("session_1", { type: "done", reply: "ok" });

    expect(registry.subscribe("session_1", () => {})).toBeNull();
    expect(registry.getStatus("session_1")).toEqual({ active: false });
  });

  test("retains latest accumulatedArguments per toolCallId under buffer pressure", () => {
    const registry = new SessionTurnRegistry();
    registry.beginTurn("session_1");

    for (let index = 0; index < 12_000; index += 1) {
      registry.publish("session_1", {
        type: "tool_input_delta",
        toolCallId: "call_1",
        tool: "write_file",
        delta: "x",
        accumulatedArguments: `{"path":"a.txt","content":"${index}"}`,
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
