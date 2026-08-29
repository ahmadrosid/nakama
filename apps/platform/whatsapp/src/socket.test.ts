import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as baileys from "@whiskeysockets/baileys";

const sockets: Array<{
  end: ReturnType<typeof mock>;
  ev: EventEmitter;
}> = [];
const delays: number[] = [];
const endOrder: string[] = [];
let endResolvers: Array<() => void> = [];

const createSocket = mock(() => {
  const ev = new EventEmitter();
  let endResolve: (() => void) | null = null;
  const endPromise = new Promise<void>((resolve) => {
    endResolve = resolve;
  });
  endResolvers.push(() => {
    endResolve?.();
  });

  const socket = {
    end: mock(() => {
      endOrder.push(`end:${sockets.length}`);
      ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: { message: "ended", output: { statusCode: 428 } },
        },
      });
      return endPromise;
    }),
    ev,
  };
  sockets.push(socket);
  return socket;
});

mock.module("@whiskeysockets/baileys", () => ({
  ...baileys,
  fetchLatestBaileysVersion: async () => ({
    version: [2, 3000, 1_023_223_821],
  }),
  makeWASocket: createSocket,
}));

const { createWhatsAppSocket, summarizeMissingTextPayload } = await import(
  "./socket"
);

const TIMEOUT_CLOSE = {
  connection: "close" as const,
  lastDisconnect: {
    error: {
      message: "Timed Out",
      output: { statusCode: 408 },
    },
  },
};

const LOGGED_OUT_CLOSE = {
  connection: "close" as const,
  lastDisconnect: {
    error: {
      message: "Logged Out",
      output: { statusCode: 401 },
    },
  },
};

const SAMPLE_UPSERT = {
  messages: [
    {
      key: {
        fromMe: false,
        id: "msg-1",
        remoteJid: "6281379292556@s.whatsapp.net",
      },
      message: {
        conversation: "hello from whatsapp",
      },
    },
  ],
  type: "notify" as const,
};

describe("WhatsApp socket reconnect", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let timeoutSpy: ReturnType<typeof spyOn>;
  let previousConfigDir: string | undefined;
  let tempConfigDir: string;

  beforeEach(async () => {
    sockets.length = 0;
    delays.length = 0;
    endOrder.length = 0;
    endResolvers = [];
    createSocket.mockClear();
    previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    tempConfigDir = await mkdtemp(join(tmpdir(), "nakama-wa-socket-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      (fn, ms) => {
        delays.push(Number(ms));
        queueMicrotask(() => (fn as () => void)());
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
    );
  });

  afterEach(async () => {
    logSpy.mockRestore();
    timeoutSpy.mockRestore();
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }
    await rm(tempConfigDir, { force: true, recursive: true });
  });

  test("ends the previous socket and waits before reconnecting on 408", async () => {
    const handle = await createWhatsAppSocket({ onMessage: async () => {} });
    await handle.start();

    expect(createSocket).toHaveBeenCalledTimes(1);

    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(delays).toEqual([1000]);
    expect(sockets[0]?.end).toHaveBeenCalled();
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  test("ignores a second close on the same socket so reconnect does not storm", async () => {
    const handle = await createWhatsAppSocket({ onMessage: async () => {} });
    await handle.start();

    emit(0, TIMEOUT_CLOSE);
    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1000]);
  });

  test("does not reconnect after logout", async () => {
    const handle = await createWhatsAppSocket({ onMessage: async () => {} });
    await handle.start();

    emit(0, LOGGED_OUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  test("clears old-socket listeners on reconnect so upserts cannot leak", async () => {
    const handle = await createWhatsAppSocket({ onMessage: async () => {} });
    await handle.start();

    const oldSocket = sockets[0];
    expect(oldSocket).toBeDefined();
    expect(oldSocket?.ev.listenerCount("messages.upsert")).toBe(1);

    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(oldSocket?.ev.listenerCount("messages.upsert")).toBe(0);
    expect(oldSocket?.ev.listenerCount("connection.update")).toBe(0);
    expect(sockets[1]?.ev.listenerCount("messages.upsert")).toBe(1);
  });

  test("does not dispatch duplicate inbound messages from a retired socket", async () => {
    const received: string[] = [];
    const handle = await createWhatsAppSocket({
      onMessage: async (data) => {
        received.push(data.text);
      },
    });
    await handle.start();

    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(2);

    sockets[0]?.ev.emit("messages.upsert", SAMPLE_UPSERT);
    await flush();
    expect(received).toEqual([]);

    sockets[1]?.ev.emit("messages.upsert", SAMPLE_UPSERT);
    await flush();
    expect(received).toEqual(["hello from whatsapp"]);
  });

  test("awaits socket.end during stop before returning", async () => {
    const handle = await createWhatsAppSocket({ onMessage: async () => {} });
    await handle.start();

    expect(endResolvers).toHaveLength(1);

    let stopDone = false;
    const stopPromise = handle.stop().then(() => {
      stopDone = true;
      endOrder.push("stop-done");
    });

    await flush();
    expect(stopDone).toBe(false);
    expect(sockets[0]?.end).toHaveBeenCalled();
    expect(sockets[0]?.ev.listenerCount("messages.upsert")).toBe(0);

    endResolvers[0]?.();
    await stopPromise;

    expect(stopDone).toBe(true);
    expect(endOrder).toEqual(["end:1", "stop-done"]);
  });

  test("stop does not start a reconnect after end emits close", async () => {
    const handle = await createWhatsAppSocket({ onMessage: async () => {} });
    await handle.start();

    endResolvers[0]?.();
    await handle.stop();
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});

function emit(index: number, update: object) {
  sockets[index]?.ev.emit("connection.update", update);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("summarizeMissingTextPayload", () => {
  test("keeps structural metadata without raw payload content or JIDs", () => {
    const privateMessage = "private contact card";
    const remoteJid = "6281379292556@s.whatsapp.net";
    const participant = "6281111111111@s.whatsapp.net";
    const summary = summarizeMissingTextPayload({
      key: {
        fromMe: false,
        id: "message-123",
        participant,
        remoteJid,
      },
      message: {
        conversation: privateMessage,
      },
      messageStubType: 1,
    });

    expect(summary).toContain('"id":"message-123"');
    expect(summary).toContain('"messageBytes":');
    expect(summary).toContain("***2556@s.whatsapp.net");
    expect(summary).toContain("***1111@s.whatsapp.net");
    expect(summary).not.toContain(privateMessage);
    expect(summary).not.toContain(remoteJid);
    expect(summary).not.toContain(participant);
  });
});
