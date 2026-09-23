import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { Resolver } from "node:dns/promises";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import postgres from "postgres";
import {
  openPostgresPassword,
  resolvePostgresAddress,
  sealPostgresPassword,
} from "./postgres-plugin";

const variables = [
  "NAKAMA_POSTGRES_KEYS",
  "NAKAMA_POSTGRES_KEY_ID",
  "NAKAMA_POSTGRES_NETWORK_POLICY",
] as const;
let original: Array<string | undefined>;
beforeEach(() => {
  original = variables.map((name) => process.env[name]);
});
afterEach(() => {
  variables.forEach((name, index) => {
    if (original[index] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original[index];
    }
  });
});

describe("PostgreSQL credential isolation", () => {
  test("randomized authenticated encryption binds organization/plugin/connection, rotates and fails closed", () => {
    const first = randomBytes(32).toString("base64");
    const second = randomBytes(32).toString("base64");
    process.env.NAKAMA_POSTGRES_KEYS = JSON.stringify({ first });
    process.env.NAKAMA_POSTGRES_KEY_ID = "first";
    const scope = JSON.stringify(["org_a", "postgresql", "connection_a"]);
    const secret = sealPostgresPassword("private-credential", scope);
    expect(secret).not.toContain("private-credential");
    expect(sealPostgresPassword("private-credential", scope)).not.toBe(secret);
    expect(openPostgresPassword(secret, scope)).toBe("private-credential");
    for (const wrong of [
      ["org_b", "postgresql", "connection_a"],
      ["org_a", "other", "connection_a"],
      ["org_a", "postgresql", "connection_b"],
    ]) {
      expect(() => openPostgresPassword(secret, JSON.stringify(wrong))).toThrow(
        "credential unavailable"
      );
    }
    process.env.NAKAMA_POSTGRES_KEYS = JSON.stringify({ first, second });
    process.env.NAKAMA_POSTGRES_KEY_ID = "second";
    const rotated = sealPostgresPassword(
      openPostgresPassword(secret, scope),
      scope
    );
    process.env.NAKAMA_POSTGRES_KEYS = JSON.stringify({ second });
    expect(openPostgresPassword(rotated, scope)).toBe("private-credential");
    expect(() => openPostgresPassword(secret, scope)).toThrow(
      "credential unavailable"
    );
    const tampered = JSON.parse(rotated);
    tampered.tag = randomBytes(16).toString("base64");
    expect(() => openPostgresPassword(JSON.stringify(tampered), scope)).toThrow(
      "credential unavailable"
    );
    process.env.NAKAMA_POSTGRES_KEYS = JSON.stringify({
      second: randomBytes(32).toString("base64"),
    });
    expect(() => openPostgresPassword(rotated, scope)).toThrow(
      "credential unavailable"
    );
    delete process.env.NAKAMA_POSTGRES_KEYS;
    expect(() => sealPostgresPassword("password", scope)).toThrow(
      "key unavailable"
    );
  });
});

describe("PostgreSQL destination policy", () => {
  test("allows only exact approved host/port/IP and rejects mixed/rebound DNS", async () => {
    process.env.NAKAMA_POSTGRES_NETWORK_POLICY = JSON.stringify([
      { addresses: ["10.77.0.1"], host: "db.example.test", port: 5432 },
    ]);
    const resolve = { cancel() {}, resolve4: async () => ["10.77.0.1"] };
    expect(await resolvePostgresAddress("db.example.test", 5432, resolve)).toBe(
      "10.77.0.1"
    );
    await expect(
      resolvePostgresAddress("other.example.test", 5432, resolve)
    ).rejects.toThrow("not approved");
    await expect(
      resolvePostgresAddress("db.example.test", 5433, resolve)
    ).rejects.toThrow("not approved");
    for (const address of [
      "10.77.0.2",
      "127.0.0.1",
      "169.254.169.254",
      "::ffff:127.0.0.1",
      "::1",
    ]) {
      const mixed = {
        cancel() {},
        resolve4: async () => ["10.77.0.1", address],
      };
      await expect(
        resolvePostgresAddress("db.example.test", 5432, mixed)
      ).rejects.toThrow("not approved");
    }
  });
  test("operator approval cannot permit loopback, metadata, IPv6 or socket paths", async () => {
    for (const host of [
      "127.0.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "/tmp/postgres.sock",
    ]) {
      process.env.NAKAMA_POSTGRES_NETWORK_POLICY = JSON.stringify([
        { addresses: [host], host, port: 5432 },
      ]);
      await expect(resolvePostgresAddress(host, 5432)).rejects.toThrow(
        "not approved"
      );
    }
  });

  test("abort cancels outstanding resolver work before connecting", async () => {
    process.env.NAKAMA_POSTGRES_NETWORK_POLICY = JSON.stringify([
      { addresses: ["10.77.0.1"], host: "db.example.test", port: 5432 },
    ]);
    let rejectLookup: (reason: Error) => void = () => {};
    let cancelled = false;
    const resolver = {
      cancel() {
        cancelled = true;
        rejectLookup(new Error("cancelled"));
      },
      resolve4: () =>
        new Promise<string[]>((_, reject) => {
          rejectLookup = reject;
        }),
    };
    const started = Date.now();
    await expect(
      resolvePostgresAddress(
        "db.example.test",
        5432,
        resolver,
        AbortSignal.timeout(25)
      )
    ).rejects.toThrow("not approved");
    expect(cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("real Bun DNS resolver cancels a non-responsive local DNS server", async () => {
    const dns = createSocket("udp4");
    dns.bind(0, "127.0.0.1");
    await once(dns, "listening");
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers([`127.0.0.1:${dns.address().port}`]);
    process.env.NAKAMA_POSTGRES_NETWORK_POLICY = JSON.stringify([
      { addresses: ["10.77.0.1"], host: "db.example.test", port: 5432 },
    ]);
    try {
      const started = Date.now();
      await expect(
        resolvePostgresAddress(
          "db.example.test",
          5432,
          resolver,
          AbortSignal.timeout(50)
        )
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      resolver.cancel();
      dns.close();
    }
  });

  test("patched driver destroys a blackholed TLS handshake without auxiliary cancellation", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let connections = 0;
    server.on("connection", () => {
      connections++;
    });
    const accepted = once(server, "connection");
    const sql = postgres({
      connect_timeout: 5,
      host: "127.0.0.1",
      max: 1,
      port: (server.address() as AddressInfo).port,
      ssl: true,
    });
    const result = sql`SELECT 1`.then(
      () => "unexpected success",
      () => "rejected"
    );
    const [socket] = await accepted;
    await once(socket, "data"); // PostgreSQL SSLRequest
    const hello = once(socket, "data");
    socket.write("S");
    const [clientHello] = await hello;
    expect(clientHello[0]).toBe(22); // TLS handshake record, deliberately unanswered
    const closed = once(socket, "close");
    try {
      const started = Date.now();
      await Promise.all([sql.end({ timeout: 0 }), sql.end({ timeout: 0 })]);
      expect(await result).toBe("rejected");
      await closed;
      expect(Date.now() - started).toBeLessThan(500);
      expect(connections).toBe(1);
    } finally {
      socket.destroy();
      await sql.end({ timeout: 0 });
      server.close();
    }
  });
});
