import { describe, expect, test } from "bun:test";
import { streamInstallEvents } from "./coding-harness-install-stream";

type TestEvent = { type: string; message?: string; error?: string };

const TIMEOUT_MS = 10;
const OUTLIVES_TIMEOUT_MS = 30;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function readEvents(response: Response): Promise<TestEvent[]> {
  const body = await response.text();
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as TestEvent);
}

describe("streamInstallEvents", () => {
  test("send after the client disconnects does not throw at the executor", async () => {
    const clientGone = deferred<void>();
    const executorDone = deferred<void>();
    const thrown: unknown[] = [];

    const response = streamInstallEvents<TestEvent>(async (send) => {
      await clientGone.promise;
      try {
        send({ message: "unpacking", type: "progress" });
      } catch (error) {
        thrown.push(error);
      }
      executorDone.resolve();
    });

    const body = response.body;
    if (!body) {
      throw new Error("the install stream response has no body");
    }
    await body.getReader().cancel();
    clientGone.resolve();
    await executorDone.promise;

    expect(thrown).toEqual([]);
  });

  test("delivers every executor event to the client", async () => {
    const response = streamInstallEvents<TestEvent>((send) => {
      send({ message: "unpacking", type: "progress" });
      send({ type: "done" });
      return Promise.resolve();
    });

    expect(await readEvents(response)).toEqual([
      { message: "unpacking", type: "progress" },
      { type: "done" },
    ]);
  });

  test("reports an executor failure as an error event", async () => {
    const response = streamInstallEvents<TestEvent>(() =>
      Promise.reject(new Error("installer exited with code 1"))
    );

    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(events[0]?.error).toContain("installer exited with code 1");
  });

  test("ends the stream with a timeout error when the installer stalls", async () => {
    const response = streamInstallEvents<TestEvent>(
      () => new Promise<void>(() => undefined),
      { timeoutMessage: "Install timed out.", timeoutMs: TIMEOUT_MS }
    );

    expect(await readEvents(response)).toEqual([
      { error: "Install timed out.", type: "error" },
    ]);
  });

  test("send after the timeout does not throw at the executor", async () => {
    const executorDone = deferred<void>();
    const thrown: unknown[] = [];

    const response = streamInstallEvents<TestEvent>(
      async (send) => {
        await new Promise((settle) =>
          setTimeout(settle, TIMEOUT_MS + OUTLIVES_TIMEOUT_MS)
        );
        try {
          send({ message: "still unpacking", type: "progress" });
        } catch (error) {
          thrown.push(error);
        }
        executorDone.resolve();
      },
      { timeoutMessage: "Install timed out.", timeoutMs: TIMEOUT_MS }
    );

    await readEvents(response);
    await executorDone.promise;

    expect(thrown).toEqual([]);
  });
});
