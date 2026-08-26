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
const createSocket = mock(() => {
  const ev = new EventEmitter();
  const socket = {
    end: mock(() => {
      ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: {
          error: { message: "ended", output: { statusCode: 428 } },
        },
      });
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

const { createWhatsAppSocket } = await import("./socket");

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

describe("WhatsApp socket reconnect", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let timeoutSpy: ReturnType<typeof spyOn>;
  let previousConfigDir: string | undefined;
  let tempConfigDir: string;

  beforeEach(async () => {
    sockets.length = 0;
    delays.length = 0;
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
});

function emit(index: number, update: object) {
  sockets[index]?.ev.emit("connection.update", update);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
