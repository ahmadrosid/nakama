import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerDesiredState, setWorkerDesiredRunning } from "@nakama/core";
import { saveWhatsAppConfig } from "@nakama/core/whatsapp-config";
import { readWhatsAppHostChannels } from "@nakama/core/whatsapp-worker";
import { WorkerManagerService } from "./worker-manager-service";

type Pm2Client = NonNullable<
  ConstructorParameters<typeof WorkerManagerService>[1]
>;

function createMockPm2() {
  return {
    connect: mock((cb: (err: Error | null) => void) => cb(null)),
    delete: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    describe: mock((_name: string, cb: Parameters<Pm2Client["list"]>[0]) =>
      cb(null, [])
    ),
    disconnect: mock(() => {}),
    flush: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    list: mock((cb: Parameters<Pm2Client["list"]>[0]) => cb(null, [])),
    restart: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
    start: mock(
      (
        _opts: Parameters<Pm2Client["start"]>[0],
        cb: (err: Error | null) => void
      ) => cb(null)
    ),
    stop: mock((_name: string, cb: (err: Error | null) => void) => cb(null)),
  };
}

const projectRoot = "/tmp/test-project";

let configDir: string | null = null;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "nakama-whatsapp-host-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (configDir) {
    await rm(configDir, { force: true, recursive: true });
    configDir = null;
  }

  delete process.env.NAKAMA_CONFIG_DIR;
});

describe("WhatsApp host worker", () => {
  test("runs every agent WhatsApp number in one host process", async () => {
    const first = { orgId: "org_a", profileId: "agent_a" };
    const second = { orgId: "org_a", profileId: "agent_b" };
    await saveWhatsAppConfig({}, first);
    await saveWhatsAppConfig({}, second);
    await setWorkerDesiredRunning("automation", false);
    const pm2 = createMockPm2();
    const service = new WorkerManagerService(projectRoot, pm2);
    // SAFETY: The test fixture matches the contract used by this test.
    const start = pm2.start as ReturnType<typeof mock>;
    // SAFETY: The test fixture matches the contract used by this test.
    const describeProcess = pm2.describe as ReturnType<typeof mock>;
    start.mockImplementation((opts, cb) => {
      describeProcess.mockImplementation((name, describeCb) =>
        describeCb(
          null,
          name === opts.name ? [{ name, pm2_env: { status: "online" } }] : []
        )
      );
      cb(null);
    });
    await service.startWorker("whatsapp", first);
    await service.startWorker("whatsapp", second);
    const token = await service.getWhatsAppContextToken();
    expect(
      await new WorkerManagerService(
        projectRoot,
        createMockPm2()
      ).getWhatsAppContextToken()
    ).toBe(token);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0].name).toBe("whatsapp-host");
    expect(start.mock.calls[0][0].env.NAKAMA_WHATSAPP_HOST).toBe("1");
    expect(start.mock.calls[0][0].env.NAKAMA_WHATSAPP_CONTEXT_TOKEN).toBe(
      token
    );
    expect(
      start.mock.calls[0][0].env.NAKAMA_CHANNEL_PROFILE_ID
    ).toBeUndefined();
    expect(await readWhatsAppHostChannels()).toEqual([first, second]);
    expect(await service.verifyWhatsAppContextToken(token)).toBe(true);
    expect(await service.verifyWhatsAppContextToken("forged")).toBe(false);

    await service.stopWorker("whatsapp", first);
    expect(await readWhatsAppHostChannels()).toEqual([second]);
    expect((await readWorkerDesiredState(first)).whatsapp).toBe(false);
    expect((await readWorkerDesiredState(second)).whatsapp).toBe(true);
    expect(pm2.delete).not.toHaveBeenCalledWith(
      "whatsapp-host",
      expect.anything()
    );

    // SAFETY: The test fixture matches the contract used by this test.
    (pm2.list as ReturnType<typeof mock>).mockImplementation((cb) =>
      cb(null, [
        { name: "whatsapp-host", pid: 7, pm2_env: { status: "online" } },
      ])
    );
    expect((await service.getAllWorkerStatuses(first)).whatsapp.status).toBe(
      "stopped"
    );
    expect((await service.getWorkerStatus("whatsapp", second))?.status).toBe(
      "online"
    );

    await service.stopWorker("whatsapp", second);
    expect(await readWhatsAppHostChannels()).toEqual([]);
    expect(pm2.delete).toHaveBeenCalledWith("whatsapp-host", expect.anything());
  });

  test("recovery replaces per-number WhatsApp processes with the host", async () => {
    const owner = { orgId: "org_a", profileId: "agent_a" };
    await saveWhatsAppConfig({}, owner);
    await setWorkerDesiredRunning("whatsapp", true, owner);
    await setWorkerDesiredRunning("automation", false);
    const pm2 = createMockPm2();
    // SAFETY: The test fixture matches the contract used by this test.
    (pm2.describe as ReturnType<typeof mock>).mockImplementation((name, cb) =>
      cb(null, name.startsWith("whatsapp-") ? [{ name }] : [])
    );
    const service = new WorkerManagerService(projectRoot, pm2);
    await service.recoverDesiredWorkers();
    // SAFETY: The test fixture matches the contract used by this test.

    const deleted = (pm2.delete as ReturnType<typeof mock>).mock.calls.map(
      ([name]) => name
    );

    expect(deleted.some((name) => /^whatsapp-[0-9a-f]{24}$/.test(name))).toBe(
      true
    );
    // SAFETY: The test fixture matches the contract used by this test.
    const starts = (pm2.start as ReturnType<typeof mock>).mock.calls;
    expect(starts.map(([opts]) => opts.name)).toEqual(["whatsapp-host"]);
    expect(await readWhatsAppHostChannels()).toEqual([owner]);
  });
});
