import { describe, expect, test } from "bun:test";
import { collapseRepeats, parseWorkerLog } from "./worker-logs.shared";

describe("parseWorkerLog", () => {
  test("splits timestamped lines and keeps plain lines whole", () => {
    const rows = parseWorkerLog(
      '2026-10-10T17:17:11.050Z INFO worker.started {"count":1}\nServer: http://127.0.0.1:4310\n\n'
    );

    expect(rows).toEqual([
      {
        level: "INFO",
        message: 'worker.started {"count":1}',
        time: "17:17:11",
      },
      { level: null, message: "Server: http://127.0.0.1:4310", time: null },
    ]);
  });
});

describe("collapseRepeats", () => {
  test("merges identical neighbours and keeps different times apart", () => {
    const row = { level: null, message: "boom", time: null };
    const timed = { level: "INFO", message: "up", time: "10:00:00" };

    expect(
      collapseRepeats([row, row, row, timed, { ...timed, time: "10:01:00" }])
    ).toEqual([
      { ...row, count: 3 },
      { ...timed, count: 1 },
      { ...timed, count: 1, time: "10:01:00" },
    ]);
  });
});
