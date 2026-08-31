import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readPassword } from "./setup";

class MockStdin extends EventEmitter {
  isTTY = true;
  rawModeEnabled = false;
  paused = true;
  failOnResume = false;

  setRawMode(enabled: boolean) {
    this.rawModeEnabled = enabled;
    return this;
  }

  isPaused() {
    return this.paused;
  }

  resume() {
    this.paused = false;
    if (this.failOnResume) {
      throw new Error("simulated stdin failure");
    }
    return this;
  }

  pause() {
    this.paused = true;
    return this;
  }

  setEncoding() {
    return this;
  }
}

describe("readPassword", () => {
  test("restores raw mode after Enter", async () => {
    const stdin = new MockStdin();
    const originalStdin = process.stdin;
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });

    try {
      const promise = readPassword("Password: ");
      stdin.emit("data", "hunter2\n");
      await expect(promise).resolves.toBe("hunter2");
      expect(stdin.rawModeEnabled).toBe(false);
    } finally {
      Object.defineProperty(process, "stdin", {
        configurable: true,
        value: originalStdin,
      });
      process.stdout.write = originalWrite;
    }
  });

  test("restores raw mode when stdin setup throws synchronously", async () => {
    const stdin = new MockStdin();
    stdin.failOnResume = true;
    const originalStdin = process.stdin;
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });

    try {
      await expect(readPassword("Password: ")).rejects.toThrow(
        "simulated stdin failure"
      );
      expect(stdin.rawModeEnabled).toBe(false);
      expect(stdin.listenerCount("data")).toBe(0);
    } finally {
      Object.defineProperty(process, "stdin", {
        configurable: true,
        value: originalStdin,
      });
      process.stdout.write = originalWrite;
    }
  });
});
