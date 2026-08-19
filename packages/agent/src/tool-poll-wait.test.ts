import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "@nakama/core";
import {
  canPollWaitOnResult,
  createToolPollWaitState,
  executeToolCallWithPollWait,
  isTerminalSnapshot,
  isToolErrorResult,
  payloadsEqual,
  TOOL_POLL_WAIT_TIMEOUT_MS,
  unwrapToolPayload,
  withPollTimeout,
} from "./tool-poll-wait";

function createFakeClock(): {
  clock: {
    now: () => number;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
} {
  let now = 0;

  return {
    clock: {
      now: () => now,
      async sleep(ms: number, signal?: AbortSignal) {
        signal?.throwIfAborted();
        now += ms;
      },
    },
  };
}

function statusTool(
  run: ToolDefinition["run"],
  name = "job_status"
): ToolDefinition {
  return {
    description: "Poll a job",
    name,
    parameters: {
      properties: { job_id: { type: "number" } },
      required: ["job_id"],
      type: "object",
    },
    run,
  };
}

function call(id: string, jobId = 17) {
  return {
    arguments: { job_id: jobId },
    id,
    name: "job_status",
  };
}

describe("tool poll wait detection", () => {
  test("unwraps MCP text envelopes", () => {
    const wrapped = {
      content: [
        {
          text: '{\n  "job_id": 17,\n  "status": "running"\n}',
          type: "text",
        },
      ],
      text: '{\n  "job_id": 17,\n  "status": "running"\n}',
    };

    expect(unwrapToolPayload(wrapped)).toEqual({
      job_id: 17,
      status: "running",
    });
  });

  test("treats running status and progress as pollable, not terminal", () => {
    const running = {
      job_id: 17,
      progress: { percent: 5 },
      status: "running",
    };

    expect(canPollWaitOnResult(running)).toBe(true);
    expect(isTerminalSnapshot(running)).toBe(false);
  });

  test("does not poll-wait a create ack that only has job_id", () => {
    expect(canPollWaitOnResult({ job_id: 17 })).toBe(false);
  });

  test("does not poll-wait mutating acks or errors", () => {
    expect(canPollWaitOnResult({ ok: true })).toBe(false);
    expect(canPollWaitOnResult({ error: "boom" })).toBe(false);
    expect(isToolErrorResult({ error: "boom" })).toBe(true);
    expect(isTerminalSnapshot({ post_id: 13, status: "succeeded" })).toBe(true);
  });

  test("compares MCP envelopes by unwrapped payload", () => {
    expect(
      payloadsEqual(
        { text: '{"status":"running","progress":{"percent":5}}' },
        {
          content: [
            {
              text: '{"progress":{"percent":5},"status":"running"}',
              type: "text",
            },
          ],
        }
      )
    ).toBe(true);
  });
});

describe("executeToolCallWithPollWait", () => {
  test("returns the first two in-flight polls immediately", async () => {
    let runs = 0;
    const tool = statusTool(() => {
      runs += 1;
      return Promise.resolve({ progress: { percent: 5 }, status: "running" });
    });
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    const first = await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    const second = await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });

    expect(runs).toBe(2);
    expect(first).toEqual({ progress: { percent: 5 }, status: "running" });
    expect(second).toEqual({ progress: { percent: 5 }, status: "running" });
  });

  test("on the third same call, waits until the payload changes", async () => {
    let runs = 0;
    const tool = statusTool(() => {
      runs += 1;
      if (runs < 5) {
        return Promise.resolve({
          progress: { percent: 5 },
          status: "running",
        });
      }
      return Promise.resolve({ progress: { percent: 20 }, status: "running" });
    });
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });
    const third = await executeToolCallWithPollWait({
      call: call("3"),
      clock,
      state,
      tools: [tool],
    });

    expect(runs).toBe(5);
    expect(third).toEqual({ progress: { percent: 20 }, status: "running" });
  });

  test("stays latched for later calls with the same name and args", async () => {
    let runs = 0;
    const percents = [5, 5, 5, 20, 20, 27];
    const tool = statusTool(() => {
      runs += 1;
      const percent = percents[runs - 1] ?? 27;
      return Promise.resolve({ progress: { percent }, status: "running" });
    });
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("3"),
      clock,
      state,
      tools: [tool],
    });
    const fourth = await executeToolCallWithPollWait({
      call: call("4"),
      clock,
      state,
      tools: [tool],
    });

    expect(runs).toBeGreaterThan(4);
    expect(fourth).toEqual({ progress: { percent: 27 }, status: "running" });
  });

  test("does not share latch across different args or tool names", async () => {
    let statusRuns = 0;
    let otherRuns = 0;
    const status = statusTool(() => {
      statusRuns += 1;
      return Promise.resolve({ status: "running" });
    });
    const other = statusTool(() => {
      otherRuns += 1;
      return Promise.resolve({ status: "running" });
    }, "other_status");
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [status, other],
    });
    await executeToolCallWithPollWait({
      call: { arguments: { job_id: 99 }, id: "2", name: "job_status" },
      clock,
      state,
      tools: [status, other],
    });
    await executeToolCallWithPollWait({
      call: { arguments: {}, id: "3", name: "other_status" },
      clock,
      state,
      tools: [status, other],
    });

    expect(statusRuns).toBe(2);
    expect(otherRuns).toBe(1);
  });

  test("never retries a mutating ack even on the third identical call", async () => {
    let runs = 0;
    const send: ToolDefinition = {
      description: "Send mail",
      name: "email_send",
      run() {
        runs += 1;
        return Promise.resolve({ message_id: "m1", ok: true });
      },
    };
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();
    const sendCall = {
      arguments: { to: "a@b.com" },
      id: "1",
      name: "email_send",
    };

    await executeToolCallWithPollWait({
      call: { ...sendCall, id: "1" },
      clock,
      state,
      tools: [send],
    });
    await executeToolCallWithPollWait({
      call: { ...sendCall, id: "2" },
      clock,
      state,
      tools: [send],
    });
    await executeToolCallWithPollWait({
      call: { ...sendCall, id: "3" },
      clock,
      state,
      tools: [send],
    });

    expect(runs).toBe(3);
  });

  test("returns errors immediately without waiting", async () => {
    let runs = 0;
    const tool = statusTool(() => {
      runs += 1;
      return Promise.resolve({ error: "MCP server is not connected." });
    });
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    for (const id of ["1", "2", "3"]) {
      const result = await executeToolCallWithPollWait({
        call: call(id),
        clock,
        state,
        tools: [tool],
      });
      expect(result).toEqual({ error: "MCP server is not connected." });
    }

    expect(runs).toBe(3);
  });

  test("returns a terminal snapshot without extra polls", async () => {
    let runs = 0;
    const tool = statusTool(() => {
      runs += 1;
      return Promise.resolve({ post_id: 13, status: "succeeded" });
    });
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });
    const third = await executeToolCallWithPollWait({
      call: call("3"),
      clock,
      state,
      tools: [tool],
    });

    expect(runs).toBe(3);
    expect(third).toEqual({ post_id: 13, status: "succeeded" });
  });

  test("times out with the last payload when the snapshot never changes", async () => {
    const tool = statusTool(() =>
      Promise.resolve({ progress: { percent: 5 }, status: "running" })
    );
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });
    const timedOut = await executeToolCallWithPollWait({
      call: call("3"),
      clock,
      state,
      timeoutMs: TOOL_POLL_WAIT_TIMEOUT_MS,
      tools: [tool],
    });

    expect(timedOut).toEqual({
      poll_timeout: true,
      progress: { percent: 5 },
      status: "running",
      waited_ms: TOOL_POLL_WAIT_TIMEOUT_MS,
    });
  });

  test("stops waiting when the turn is aborted", async () => {
    const controller = new AbortController();
    let sleeps = 0;
    const tool = statusTool(() => Promise.resolve({ status: "running" }));
    const clock = {
      now: () => sleeps * 500,
      async sleep(_ms: number, signal?: AbortSignal) {
        sleeps += 1;
        controller.abort();
        signal?.throwIfAborted();
      },
    };
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });

    await expect(
      executeToolCallWithPollWait({
        call: call("3"),
        clock,
        context: { signal: controller.signal },
        state,
        tools: [tool],
      })
    ).rejects.toThrow();
  });

  test("waits on MCP-wrapped running payloads", async () => {
    let runs = 0;
    const tool = statusTool(() => {
      runs += 1;
      const payload =
        runs < 4
          ? { progress: { percent: 5 }, status: "running" }
          : { progress: { percent: 20 }, status: "running" };
      return Promise.resolve({
        content: [{ text: JSON.stringify(payload), type: "text" }],
        text: JSON.stringify(payload),
      });
    });
    const { clock } = createFakeClock();
    const state = createToolPollWaitState();

    await executeToolCallWithPollWait({
      call: call("1"),
      clock,
      state,
      tools: [tool],
    });
    await executeToolCallWithPollWait({
      call: call("2"),
      clock,
      state,
      tools: [tool],
    });
    const third = await executeToolCallWithPollWait({
      call: call("3"),
      clock,
      state,
      tools: [tool],
    });

    expect(runs).toBe(4);
    expect(unwrapToolPayload(third)).toEqual({
      progress: { percent: 20 },
      status: "running",
    });
  });
});

describe("withPollTimeout", () => {
  test("wraps non-objects", () => {
    expect(withPollTimeout("still going", 1200)).toEqual({
      poll_timeout: true,
      result: "still going",
      waited_ms: 1200,
    });
  });
});
