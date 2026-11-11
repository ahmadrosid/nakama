import {
  afterEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { z } from "zod";
import type { CaptureSocketData } from "../../services/google-meet/service";
import * as transcription from "../../services/google-meet/transcription";
import { setupTestConfigDir } from "../../test-config-dir";
import { cleanups, setup } from "./google-meet-extension-setup";

setupTestConfigDir("nakama-meet-capture-test-");

afterEach(async () => {
  setSystemTime();

  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

const startSchema = z
  .object({ captureUrl: z.string(), meetingId: z.string(), ticket: z.string() })
  .strict();

/** The main server as `index.ts` runs it: the app's fetch plus the Meet socket. */
async function serveCapture() {
  const connect = spyOn(transcription, "connectTranscription");
  connect.mockImplementation(async ({ onSegment }) => ({
    close() {},
    async finish() {
      onSegment({
        id: "turn",
        receivedAt: Date.now(),
        text: "Captured speech",
      });
    },
    push() {},
  }));

  const context = await setup(() => "test");
  const key = await context.pair();

  const server = Bun.serve<CaptureSocketData>({
    fetch: (request, bunServer) =>
      context.app.fetch(request, { server: bunServer }),
    hostname: "127.0.0.1",
    port: 0,
    websocket: context.googleMeetService.captureSocket,
  });

  cleanups.unshift(async () => {
    connect.mockRestore();
    await server.stop(true);
  });

  const origin = `http://127.0.0.1:${server.port}`;

  const start = async (
    headers: Record<string, string> = {},
    durationMinutes?: number
  ) => {
    const response = await fetch(`${origin}/v1/meet/extension/start`, {
      body: JSON.stringify({
        durationMinutes,
        url: "https://meet.google.com/abc-defg-hij",
      }),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...headers,
      },
      method: "POST",
    });

    expect(response.status).toBe(200);

    return startSchema.parse(await response.json());
  };

  const leave = async (meetingId: string) => {
    const response = await fetch(`${origin}/v1/meet/extension/leave`, {
      body: JSON.stringify({ meetingId }),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
  };

  return { ...context, key, leave, origin, server, start };
}

/** Opens a socket, sends `first` once open, and records messages and the close. */
function openSocket(url: string, first?: string | Uint8Array) {
  const ws = new WebSocket(url);
  const messages: string[] = [];
  let opened = false;

  ws.addEventListener("open", () => {
    opened = true;

    if (first !== undefined) {
      ws.send(first);
    }
  });
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)).type);
  });

  const closed = new Promise<{ code: number; opened: boolean }>((resolve) => {
    ws.addEventListener("close", (event) =>
      resolve({ code: event.code, opened })
    );
  });

  return { closed, messages, ws };
}

const auth = (ticket: string, meetingId: string) =>
  JSON.stringify({ meetingId, ticket, type: "auth" });

describe("Meet capture socket on the main server", () => {
  test("upgrades only GET /v1/meet/capture", async () => {
    const { origin } = await serveCapture();
    const socketOrigin = origin.replace(/^http:/, "ws:");

    const capture = openSocket(`${socketOrigin}/v1/meet/capture`);
    await new Promise((resolve) =>
      capture.ws.addEventListener("open", resolve)
    );
    capture.ws.close();
    expect((await capture.closed).opened).toBe(true);

    for (const path of [
      "/capture",
      "/v1/meet/captures",
      "/v1/meet/extension/status",
      "/health",
    ]) {
      expect((await openSocket(`${socketOrigin}${path}`).closed).opened).toBe(
        false
      );
    }

    // A plain request to the socket path is not upgraded.
    expect((await fetch(`${origin}/v1/meet/capture`)).status).toBe(426);
  });

  test("start returns a ticket and a capture URL with no secret in it", async () => {
    const { key, leave, origin, start } = await serveCapture();
    const started = await start();

    expect(started.captureUrl).toBe(
      `${origin.replace(/^http:/, "ws:")}/v1/meet/capture`
    );
    expect(started.captureUrl).not.toContain(started.ticket);
    expect(new URL(started.captureUrl).search).toBe("");

    // A TLS terminator in front makes the socket wss.
    await leave(started.meetingId);
    const secure = await start({ "X-Forwarded-Proto": "https" });
    expect(new URL(secure.captureUrl).protocol).toBe("wss:");

    const status = await fetch(`${origin}/v1/meet/extension/status`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect((await status.json()).captureProtocol).toBe(3);
  });

  test("closes with 1008 when no auth message comes within 5 s", async () => {
    const { start } = await serveCapture();
    const { captureUrl } = await start();
    const begin = Date.now();

    const { closed } = openSocket(captureUrl);

    expect((await closed).code).toBe(1008);
    expect(Date.now() - begin).toBeGreaterThanOrEqual(4900);
  }, 10_000);

  test("closes with 1008 on a bad, wrong-meeting or expired ticket, or audio before auth", async () => {
    const { leave, start } = await serveCapture();
    const first = await start();

    const attempts = [
      auth("not-a-ticket", first.meetingId),
      // The real ticket, sent for another meeting.
      auth(first.ticket, "another-meeting"),
      "not json",
      JSON.stringify({ ticket: first.ticket, type: "auth" }),
      new Uint8Array(4800),
    ];

    for (const message of attempts) {
      expect((await openSocket(first.captureUrl, message).closed).code).toBe(
        1008
      );
    }

    // The failed attempts did not use the ticket up.
    const valid = openSocket(
      first.captureUrl,
      auth(first.ticket, first.meetingId)
    );

    await Bun.sleep(200);
    expect(valid.ws.readyState).toBe(WebSocket.OPEN);
    valid.ws.close();
    await valid.closed;
    await leave(first.meetingId);

    const short = await start({}, 1);
    setSystemTime(new Date(Date.now() + 2 * 60_000));
    expect(
      (
        await openSocket(short.captureUrl, auth(short.ticket, short.meetingId))
          .closed
      ).code
    ).toBe(1008);
  });

  test("a valid ticket streams PCM, the stop handshake finalizes, and the ticket works once", async () => {
    const { key, origin, start } = await serveCapture();
    const { captureUrl, meetingId, ticket } = await start();
    const socket = openSocket(captureUrl, auth(ticket, meetingId));

    const finalized = new Promise<void>((resolve, reject) => {
      socket.ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));

        if (message.type === "ready") {
          socket.ws.send(new Uint8Array(4800));
          socket.ws.send(JSON.stringify({ protocol: 3, type: "stop" }));
        }

        if (message.type === "capture-finalized") {
          resolve();
        }
      });
      socket.closed.then(() =>
        reject(new Error("Socket closed before finalization"))
      );
    });

    await finalized;
    expect(socket.messages).toEqual(["ready", "capture-finalized"]);
    await socket.closed;

    // Used once: the same ticket cannot open a second capture.
    expect(
      (await openSocket(captureUrl, auth(ticket, meetingId)).closed).code
    ).toBe(1008);
    await Bun.sleep(10);

    const transcript = await fetch(
      `${origin}/v1/meet/extension/transcript?meetingId=${meetingId}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );

    const body = await transcript.json();

    expect(body.meeting.state).toBe("finished");
    expect(
      body.segments.map((segment: { text: string }) => segment.text)
    ).toEqual(["Captured speech"]);
  });
});
