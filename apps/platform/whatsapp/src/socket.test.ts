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
import processMessage from "@whiskeysockets/baileys/lib/Utils/process-message.js";
import { usePrivateMultiFileAuthState } from "./auth-state";
import { createBaileysLogger } from "./baileys-logger";

const sockets: Array<{
  end: ReturnType<typeof mock>;
  ev: EventEmitter;
}> = [];
const delays: number[] = [];
const endOrder: string[] = [];
let endResolvers: Array<() => void> = [];

const createSocket = mock((_config: baileys.UserFacingSocketConfig) => {
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
    ev: Object.assign(ev, { destroy: () => ev.removeAllListeners() }),
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

test.each([null, undefined, "request-123"])(
  "peer response delivers the recovered message with stanza ID: %s",
  async (stanzaId) => {
    const del = mock((key: string) => {
      key.toString();
    });
    const creds = baileys.initAuthCreds();
    creds.me = { id: "123@s.whatsapp.net", name: "Test" };
    const logger = createBaileysLogger();
    const ev = baileys.makeEventBuffer(logger);
    const onMessage = mock();
    ev.on("messages.upsert", onMessage);
    const keyStore: baileys.SignalKeyStoreWithTransaction = {
      get: () => ({}),
      isInTransaction: () => false,
      set: () => {},
      transaction: (exec) => exec(),
    };
    const signalRepository =
      baileys.DEFAULT_CONNECTION_CONFIG.makeSignalRepository(
        { creds, keys: keyStore },
        logger
      );
    const recoveredMessage = {
      key: { id: "message-123", remoteJid: creds.me.id },
      message: { conversation: "recovered message" },
    };

    await processMessage(
      {
        key: { fromMe: true, remoteJid: creds.me.id },
        message: {
          protocolMessage: {
            peerDataOperationRequestResponseMessage: {
              peerDataOperationResult: [
                {
                  placeholderMessageResendResponse: {
                    webMessageInfoBytes:
                      baileys.proto.WebMessageInfo.encode(
                        recoveredMessage
                      ).finish(),
                  },
                },
              ],
              stanzaId,
            },
            type: baileys.proto.Message.ProtocolMessage.Type
              .PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE,
          },
        },
      },
      {
        creds,
        ev,
        getMessage: async () => undefined,
        keyStore,
        options: {},
        placeholderResendCache: {
          del,
          flushAll: () => {},
          get: () => undefined,
          set: () => {},
        },
        shouldProcessHistoryMsg: false,
        signalRepository,
      }
    );

    signalRepository.close?.();
    ev.destroy();
    expect(del.mock.calls).toEqual([["message-123"]]);
    expect(onMessage).toHaveBeenCalledWith({
      messages: [expect.objectContaining(recoveredMessage)],
      requestId: stanzaId,
      type: "notify",
    });
  }
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

  test.each([
    ["123:2@s.whatsapp.net", "456:2@lid"],
    ["456:2@lid", "123:2@s.whatsapp.net"],
  ])(
    "decrypts linked-device messages after %s switches to %s",
    async (originalJid, migratedJid) => {
      const handle = await createWhatsAppSocket({ onMessage: async () => {} });
      await handle.start();
      const config = createSocket.mock.calls[0]![0];
      const receiver = config.auth!;
      receiver.creds.me = { id: "123:9@s.whatsapp.net", lid: "456:9@lid" };
      const { state: sender } = await usePrivateMultiFileAuthState(
        join(tempConfigDir, "sender")
      );
      const logger = createBaileysLogger();
      for (const state of [sender, receiver]) {
        state.keys = baileys.addTransactionCapability(
          state.keys,
          logger,
          baileys.DEFAULT_CONNECTION_CONFIG.transactionOpts
        );
      }
      const makeRepository =
        baileys.DEFAULT_CONNECTION_CONFIG.makeSignalRepository;
      const sending = makeRepository(sender, logger);
      const receiving = config.makeSignalRepository!(receiver, logger);
      const destination = "123:9@s.whatsapp.net";
      const { creds } = receiver;
      const preKey = baileys.Curve.generateKeyPair();
      await receiver.keys.set({ "pre-key": { "1": preKey } });
      await sending.injectE2ESession({
        jid: destination,
        session: {
          identityKey: baileys.generateSignalPubKey(
            creds.signedIdentityKey.public
          ),
          preKey: {
            keyId: 1,
            publicKey: baileys.generateSignalPubKey(preKey.public),
          },
          registrationId: creds.registrationId,
          signedPreKey: {
            keyId: creds.signedPreKey.keyId,
            publicKey: baileys.generateSignalPubKey(
              creds.signedPreKey.keyPair.public
            ),
            signature: creds.signedPreKey.signature,
          },
        },
      });
      const first = await sending.encryptMessage({
        data: Buffer.from("first"),
        jid: destination,
      });
      await receiving.decryptMessage({ jid: originalJid, ...first });
      const ack = await receiving.encryptMessage({
        data: Buffer.from("ack"),
        jid: originalJid,
      });
      await sending.decryptMessage({ jid: destination, ...ack });

      // A stale session at the new address fails MAC verification; the original still works.
      const stale = await sender.keys.get("session", [
        sending.jidToSignalProtocolAddress(destination),
      ]);
      await receiver.keys.set({
        session: {
          [receiving.jidToSignalProtocolAddress(migratedJid)]:
            stale[sending.jidToSignalProtocolAddress(destination)],
        },
      });
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const message = await sending.encryptMessage({
          data: Buffer.from("after migration"),
          jid: destination,
        });
        expect(message.type).toBe("msg");
        await expect(
          receiving.decryptMessage({ jid: "456:3@lid", ...message })
        ).rejects.toThrow();
        await expect(
          receiving.decryptMessage({ jid: "789:2@lid", ...message })
        ).rejects.toThrow();
        const corrupted = Buffer.from(message.ciphertext);
        corrupted[corrupted.length - 1] += 1;
        await expect(
          receiving.decryptMessage({
            ...message,
            ciphertext: corrupted,
            jid: migratedJid,
          })
        ).rejects.toThrow();
        const plaintext = await receiving.decryptMessage({
          jid: migratedJid,
          ...message,
        });
        expect(Buffer.from(plaintext).toString()).toBe("after migration");
        const errorsAfterRecovery = errorSpy.mock.calls.length;
        const next = await sending.encryptMessage({
          data: Buffer.from("next"),
          jid: destination,
        });
        expect(
          Buffer.from(
            await receiving.decryptMessage({ jid: migratedJid, ...next })
          ).toString()
        ).toBe("next");
        expect(errorSpy.mock.calls.length).toBe(errorsAfterRecovery);
        // The alternate session must retain replay protection and device isolation.
        await expect(
          receiving.decryptMessage({ jid: migratedJid, ...next })
        ).rejects.toThrow();
      } finally {
        errorSpy.mockRestore();
        sending.close?.();
        receiving.close?.();
      }
    }
  );

  test("clears old-socket listeners on reconnect so upserts cannot leak", async () => {
    const received: string[] = [];
    const handle = await createWhatsAppSocket({
      onMessage: async (data) => {
        received.push(data.text);
      },
    });
    await handle.start();

    const oldSocket = sockets[0];
    expect(oldSocket?.ev.listenerCount("messages.upsert")).toBe(1);

    emit(0, TIMEOUT_CLOSE);
    await flush();

    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(oldSocket?.ev.listenerCount("messages.upsert")).toBe(0);
    expect(oldSocket?.ev.listenerCount("connection.update")).toBe(0);
    expect(sockets[1]?.ev.listenerCount("messages.upsert")).toBe(1);

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
    await flush();

    expect(stopDone).toBe(true);
    expect(endOrder).toEqual(["end:1", "stop-done"]);
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
