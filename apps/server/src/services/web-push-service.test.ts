import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

    // Windows does not expose POSIX owner/group permission bits.
    if (process.platform !== "win32") {
      expect((await stat(path)).mode % 512).toBe(0o600);
    }

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

  test("names a non-localhost contact when the instance has no https URL", async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-"));
    const service = new WebPushService(join(dir, "web-push.json"));
    const endpoint = "https://web.push.apple.com/QG9";
    await service.subscribe("u1", { endpoint, keys: await browserKeys() });

    const previous = process.env.NAKAMA_WEB_PUBLIC_URL;
    process.env.NAKAMA_WEB_PUBLIC_URL = "http://192.168.1.20:4310";

    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 201 })
    );

    try {
      await service.notify("u1", message);

      const [, init] = fetchSpy.mock.calls[0] ?? [];

      const token = new Headers(init?.headers)
        .get("Authorization")
        ?.match(/t=([^,]+)/)?.[1];

      const claims = JSON.parse(
        Buffer.from(token?.split(".")[1] ?? "", "base64url").toString()
      );

      expect(claims.sub).toStartWith("https:");
      expect(claims.sub).not.toContain("localhost");
    } finally {
      fetchSpy.mockRestore();

      if (previous === undefined) {
        delete process.env.NAKAMA_WEB_PUBLIC_URL;
      } else {
        process.env.NAKAMA_WEB_PUBLIC_URL = previous;
      }
    }
  });

  test("keeps the key pair a browser subscribed with across restarts", async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-"));
    const path = join(dir, "web-push.json");
    const first = await new WebPushService(path).publicKey();

    expect(await new WebPushService(path).publicKey()).toBe(first);
  });

  test("moves a broken state file aside and keeps working", async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-"));
    const path = join(dir, "web-push.json");
    await writeFile(path, '{"subscriptions": {');
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      expect(await new WebPushService(path).publicKey()).toBeString();
      expect(JSON.parse(await readFile(path, "utf8")).vapid).not.toBeNull();
      expect(
        (await readdir(dir)).some((name) => name.includes(".corrupt-"))
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test("does not replace the key pair when the file cannot be read", async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-"));
    // A directory where the file should be: reading it fails with EISDIR.
    const path = join(dir, "web-push.json");
    await mkdir(path);

    await expect(new WebPushService(path).publicKey()).rejects.toThrow();
    expect((await stat(path)).isDirectory()).toBe(true);
  });
});
