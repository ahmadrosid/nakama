import { afterEach, describe, expect, mock, test } from "bun:test";
import { TerminalInput } from "./terminal-input";

type StdinStub = NodeJS.ReadStream & {
  setRawMode: (mode: boolean) => NodeJS.ReadStream;
};

describe("TerminalInput encoding", () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores.splice(0).reverse()) {
      restore();
    }
  });

  function stubStdio() {
    const stdin = process.stdin as StdinStub;
    const setEncoding = mock((_encoding?: BufferEncoding | null) => stdin);
    const setRawMode = mock((_mode: boolean) => stdin);
    const resume = mock(() => stdin);
    const on = mock(() => stdin);
    const off = mock(() => stdin);
    const write = mock(() => true);

    const originals = {
      off: stdin.off,
      on: stdin.on,
      resume: stdin.resume,
      setEncoding: stdin.setEncoding,
      setRawMode: stdin.setRawMode,
      write: process.stdout.write,
    };

    stdin.setEncoding = setEncoding as typeof stdin.setEncoding;
    stdin.setRawMode = setRawMode as typeof stdin.setRawMode;
    stdin.resume = resume as typeof stdin.resume;
    stdin.on = on as typeof stdin.on;
    stdin.off = off as typeof stdin.off;
    process.stdout.write = write as typeof process.stdout.write;

    restores.push(() => {
      stdin.setEncoding = originals.setEncoding;
      stdin.setRawMode = originals.setRawMode;
      stdin.resume = originals.resume;
      stdin.on = originals.on;
      stdin.off = originals.off;
      process.stdout.write = originals.write;
    });

    return setEncoding;
  }

  function stubReadableEncoding(value: BufferEncoding | null) {
    const descriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "readableEncoding"
    );
    Object.defineProperty(process.stdin, "readableEncoding", {
      configurable: true,
      get: () => value,
    });
    restores.push(() => {
      if (descriptor) {
        Object.defineProperty(process.stdin, "readableEncoding", descriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "readableEncoding");
      }
    });
  }

  test("stop restores stdin encoding set before start", () => {
    stubReadableEncoding("ascii");
    const setEncoding = stubStdio();
    const input = new TerminalInput();

    input.start();
    input.stop();

    expect(setEncoding.mock.calls.map((call) => call[0])).toEqual([
      "utf8",
      "ascii",
    ]);
  });

  test("stop restores null encoding when stdin had no encoding", () => {
    stubReadableEncoding(null);
    const setEncoding = stubStdio();
    const input = new TerminalInput();

    input.start();
    input.stop();

    expect(setEncoding.mock.calls.map((call) => call[0])).toEqual([
      "utf8",
      null,
    ]);
  });
});
