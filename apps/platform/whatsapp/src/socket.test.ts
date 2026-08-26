import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  createWhatsAppSocket,
  WHATSAPP_RECONNECT_BASE_MS,
  whatsappReconnectDelayMs,
} from "./socket";

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

describe("whatsappReconnectDelayMs", () => {
  test("backs off from 1s and caps at 30s", () => {
    expect(whatsappReconnectDelayMs(0)).toBe(WHATSAPP_RECONNECT_BASE_MS);
    expect(whatsappReconnectDelayMs(1)).toBe(2000);
    expect(whatsappReconnectDelayMs(2)).toBe(4000);
    expect(whatsappReconnectDelayMs(5)).toBe(30_000);
    expect(whatsappReconnectDelayMs(8)).toBe(30_000);
  });
});

describe("WhatsApp socket reconnect", () => {
  const logSpies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    for (const spy of logSpies.splice(0)) {
      spy.mockRestore();
    }
  });

  test("ends the previous socket and waits before reconnecting on 408", async () => {
    const { createSocket, delays, emit, sockets } = createReconnectHarness();
    logSpies.push(spyOn(console, "log").mockImplementation(() => {}));

    const handle = await createHandle({ createSocket, delays });
    await handle.start();

    expect(createSocket).toHaveBeenCalledTimes(1);

    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(delays).toEqual([WHATSAPP_RECONNECT_BASE_MS]);
    expect(sockets[0]?.end).toHaveBeenCalled();
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  test("ignores a second close on the same socket so reconnect does not storm", async () => {
    const { createSocket, delays, emit } = createReconnectHarness();
    logSpies.push(spyOn(console, "log").mockImplementation(() => {}));

    const handle = await createHandle({ createSocket, delays });
    await handle.start();

    emit(0, TIMEOUT_CLOSE);
    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([WHATSAPP_RECONNECT_BASE_MS]);
  });

  test("does not reconnect after logout", async () => {
    const { createSocket, delays, emit } = createReconnectHarness();
    logSpies.push(spyOn(console, "log").mockImplementation(() => {}));

    const handle = await createHandle({ createSocket, delays });
    await handle.start();

    emit(0, LOGGED_OUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});

function createReconnectHarness() {
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

  return {
    createSocket,
    delays,
    emit(index: number, update: object) {
      sockets[index]?.ev.emit("connection.update", update);
    },
    sockets,
  };
}

async function createHandle(input: {
  createSocket: () => { ev: EventEmitter; end: () => void };
  delays: number[];
}) {
  return createWhatsAppSocket({
    createSocket: input.createSocket as never,
    delay: async (ms) => {
      input.delays.push(ms);
    },
    fetchVersion: async () => ({ version: [2, 3000, 1_023_223_821] }),
    loadAuthState: async () => ({
      saveCreds: async () => {},
      state: {
        creds: { me: { id: "123@s.whatsapp.net" } },
        keys: {},
      } as never,
    }),
    onMessage: async () => {},
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
