import { expect, test } from "bun:test";
import { MeetDependencies } from "./meet-dependencies";

test("dependency setup is single-flight and reports each step before completing", async () => {
  const completed = new Set<string>();
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setup = new MeetDependencies("/tmp/meet-dependency-test", {
    check: async (id) => completed.has(id),
    install: async (id) => {
      calls.push(id);
      if (id === "system") {
        await gate;
      }
      completed.add(id);
    },
    supported: true,
  });
  await setup.start();
  await setup.start();
  expect((await setup.status()).state).toBe("installing");
  expect(calls).toEqual(["system"]);
  release();
  await setup.wait();
  expect(calls).toEqual(["system", "runtime", "browser", "verify"]);
  expect((await setup.status()).state).toBe("ready");
});

test("failed setup retries only missing dependencies and never reports ready early", async () => {
  const completed = new Set(["system"]);
  let fail = true;
  const calls: string[] = [];
  const setup = new MeetDependencies("/tmp/meet-dependency-test", {
    check: async (id) => completed.has(id),
    install: async (id) => {
      calls.push(id);
      if (id === "browser" && fail) {
        throw new Error("private download details");
      }
      completed.add(id);
    },
    supported: true,
  });
  await setup.start();
  await setup.wait();
  const failed = await setup.status();
  expect(failed.state).toBe("failed");
  expect(failed.steps.find((step) => step.id === "browser")?.state).toBe(
    "failed"
  );
  expect(JSON.stringify(failed)).not.toContain("private download details");
  fail = false;
  await setup.start();
  await setup.wait();
  expect(calls).toEqual(["runtime", "browser", "browser", "verify"]);
  expect((await setup.status()).state).toBe("ready");
});

test("unsupported hosts cannot start dependency installation", async () => {
  const setup = new MeetDependencies("/tmp/meet-dependency-test", {
    check: async () => false,
    install: async () => {
      throw new Error("must not run");
    },
    supported: false,
  });
  expect((await setup.status()).state).toBe("unsupported");
  await expect(setup.start()).rejects.toThrow();
});
