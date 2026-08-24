import { describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { AuthenticationState } from "@whiskeysockets/baileys";

const baileys = await import("@whiskeysockets/baileys");
const authStateModule = await import("./auth-state");
const events = new EventEmitter();
const endSocket = mock(() => undefined);
const persistenceError = new Error("auth persistence failed");
const rejectedSave = mock(() => Promise.reject(persistenceError));

const state = {
  creds: {},
  keys: {
    get: async () => ({}),
    set: async () => undefined,
  },
} as unknown as AuthenticationState;

mock.module("./auth-state", () => ({
  ...authStateModule,
  usePrivateMultiFileAuthState: async () => ({
    saveCreds: rejectedSave,
    state,
  }),
}));

mock.module("@whiskeysockets/baileys", () => ({
  ...baileys,
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  makeWASocket: () => ({
    end: endSocket,
    ev: {
      on: (event: string, listener: (value: unknown) => void) => {
        events.on(event, listener);
      },
    },
  }),
  useMultiFileAuthState: async () => ({
    saveCreds: rejectedSave,
    state,
  }),
}));

const { createWhatsAppSocket } = await import("./socket");

describe("WhatsApp socket auth persistence", () => {
  test("stops the socket when credential persistence fails", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const handle = await createWhatsAppSocket({
      onMessage: async () => undefined,
    });
    await handle.start();

    events.emit("creds.update", {});
    await Promise.resolve();

    expect(rejectedSave).toHaveBeenCalledTimes(1);
    expect(endSocket).toHaveBeenCalledTimes(1);
    expect(handle.socket).toBeNull();
    consoleError.mockRestore();
  });
});
