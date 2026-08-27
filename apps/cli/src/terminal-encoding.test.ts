import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { restoreReadableEncoding } from "./terminal-input";

describe("restoreReadableEncoding", () => {
  test("restores a prior named encoding", async () => {
    const stream = new Readable({
      read() {
        this.push(Buffer.from([0x61]));
        this.push(null);
      },
    });
    stream.setEncoding("utf8");
    restoreReadableEncoding(stream, "hex");

    const chunk = await new Promise<unknown>((resolve) => {
      stream.once("data", resolve);
    });

    expect(chunk).toBe("61");
  });

  test("restores buffer mode after utf8 when previous was unset", async () => {
    const stream = new Readable({
      read() {
        this.push(Buffer.from([0xc3, 0xa9]));
        this.push(null);
      },
    });
    stream.setEncoding("utf8");
    restoreReadableEncoding(stream, null);

    const chunk = await new Promise<unknown>((resolve) => {
      stream.once("data", resolve);
    });

    expect(Buffer.isBuffer(chunk)).toBe(true);
  });
});
