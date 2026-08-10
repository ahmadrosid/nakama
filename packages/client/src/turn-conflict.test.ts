import { describe, expect, test } from "bun:test";
import { createClient } from "./index";
import { isActiveTurnConflict, retryWhileTurnIsStopping } from "./stream";

const conflict = new Error(
  "A response is already in progress for this session."
);

function createClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

describe("retryWhileTurnIsStopping", () => {
  test("rides out the window where a cancelled turn is still unwinding", async () => {
    // Measured on loopback: the server sees the abort 30 to 45ms after the client
    // closes the socket, and a follow-up sent inside that window gets a 409.
    let attempts = 0;
    const clock = createClock();

    const result = await retryWhileTurnIsStopping(
      () => {
        attempts += 1;
        return attempts < 3
          ? Promise.reject(conflict)
          : Promise.resolve("sent");
      },
      { now: clock.now, sleep: clock.sleep }
    );

    expect(result).toBe("sent");
    expect(attempts).toBe(3);
  });

  test("gives up when the conflict outlives the window", async () => {
    let attempts = 0;
    const clock = createClock();

    const pending = retryWhileTurnIsStopping(
      () => {
        attempts += 1;
        return Promise.reject(conflict);
      },
      { now: clock.now, sleep: clock.sleep }
    );

    await expect(pending).rejects.toThrow("already in progress");
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(22);
  });

  test("does not retry once the caller has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let attempts = 0;

    const pending = retryWhileTurnIsStopping(
      () => {
        attempts += 1;
        return Promise.reject(conflict);
      },
      { signal: controller.signal }
    );

    await expect(pending).rejects.toThrow("already in progress");
    expect(attempts).toBe(1);
  });

  test("does not retry unrelated failures", async () => {
    let attempts = 0;

    const pending = retryWhileTurnIsStopping(() => {
      attempts += 1;
      return Promise.reject(new Error("Session not found"));
    });

    await expect(pending).rejects.toThrow("Session not found");
    expect(attempts).toBe(1);
  });

  test("recognises only the turn conflict message", () => {
    expect(isActiveTurnConflict(conflict)).toBe(true);
    expect(isActiveTurnConflict(new Error("Session not found"))).toBe(false);
    expect(isActiveTurnConflict("already in progress")).toBe(false);
  });
});

test("sendStream retries a 409 from a turn that is still stopping", async () => {
  // The web Stop button aborts the fetch and sends the next message straight
  // away; the server only sees the abort once the socket closes, so the new
  // POST can land on a turn that is already dying.
  let attempts = 0;
  const client = createClient({
    baseUrl: "http://localhost:4310",
    fetch: (_input, _init) => {
      attempts += 1;

      if (attempts === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "A response is already in progress for this session.",
            }),
            { headers: { "Content-Type": "application/json" }, status: 409 }
          )
        );
      }

      return Promise.resolve(
        new Response('data: {"type":"done","reply":"ok"}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        })
      );
    },
  });

  const session = client.createChatSession("session-race", "web");
  const reply = await session.sendStream("are you there?", () => {});

  expect(reply).toBe("ok");
  expect(attempts).toBe(2);
});

test("sendStream surfaces a 409 that never clears", async () => {
  let attempts = 0;
  const client = createClient({
    baseUrl: "http://localhost:4310",
    fetch: () => {
      attempts += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: "A response is already in progress for this session.",
          }),
          { headers: { "Content-Type": "application/json" }, status: 409 }
        )
      );
    },
  });

  const session = client.createChatSession("session-stuck", "web");

  await expect(session.sendStream("are you there?", () => {})).rejects.toThrow(
    "already in progress"
  );
  expect(attempts).toBeGreaterThan(1);
}, 15_000);
