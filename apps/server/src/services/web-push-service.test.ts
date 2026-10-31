import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebPushService } from "./web-push-service";

async function browserKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  );

  return {
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
      "base64url"
    ),
    p256dh: Buffer.from(raw).toString("base64url"),
  };
}

const message = {
  body: "Done",
  tag: "session-1",
  title: "Writer",
  url: "/chat/p/s",
};

let dir = "";

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("WebPushService", () => {
  test("pushes to a subscribed user, skips one who is on screen, forgets a gone endpoint", async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-"));
    const path = join(dir, "web-push.json");
    const service = new WebPushService(path);
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    await service.subscribe("u1", { endpoint, keys: await browserKeys() });

    expect((await stat(path)).mode.toString(8).slice(-3)).toBe("600");

    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 201 })
    );

    try {
      service.setPresence("u1", "tab-1", true);
      await service.notify("u1", message);
      expect(fetchSpy).not.toHaveBeenCalled();

      service.setPresence("u1", "tab-1", false);
      await service.notify("u1", message);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe(endpoint);
      expect(new Headers(init?.headers).get("Authorization")).toStartWith(
        "vapid t="
      );

      fetchSpy.mockResolvedValue(new Response(null, { status: 410 }));
      await service.notify("u1", message);

      const saved = JSON.parse(await readFile(path, "utf8"));
      expect(saved.subscriptions).toEqual({});
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("keeps the key pair a browser subscribed with across restarts", async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-"));
    const path = join(dir, "web-push.json");
    const first = await new WebPushService(path).publicKey();

    expect(await new WebPushService(path).publicKey()).toBe(first);
  });
});
