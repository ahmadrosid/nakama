import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANYDOC_MAX_CONCURRENT,
  ANYDOC_MAX_OUTPUT_BYTES,
  ANYDOC_MAX_QUEUE,
  type AnydocConvertFn,
  convertDocumentBytes,
  resolveAnydocFormat,
} from "./anydoc-text";

const FIXTURES = join(import.meta.dir, "__fixtures__");
const SAMPLE_PDF = readFileSync(join(FIXTURES, "sample.pdf"));
const SAMPLE_XLSX = readFileSync(join(FIXTURES, "sample.xlsx"));
const SAMPLE_DOCX = readFileSync(join(FIXTURES, "sample.docx"));
const SAMPLE_CSV = Buffer.from("col\n1\n", "utf8");

/**
 * Converter that never settles until `release` is called, so a test can hold
 * the concurrency slots. Conversions started after the release settle
 * immediately, which lets a parked queue drain.
 */
function holdingConverter(): {
  convertFn: AnydocConvertFn;
  release: () => void;
} {
  const parked: Array<(value: string) => void> = [];
  let released = false;
  return {
    convertFn: () => {
      if (released) {
        return Promise.resolve("# held");
      }
      return new Promise<string>((resolve) => {
        parked.push(resolve);
      });
    },
    release: () => {
      released = true;
      while (parked.length > 0) {
        parked.shift()?.("# held");
      }
    },
  };
}

describe("resolveAnydocFormat", () => {
  test("maps spreadsheet media types and extensions to xlsx", () => {
    expect(
      resolveAnydocFormat(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "budget.bin"
      )
    ).toBe("xlsx");
    expect(resolveAnydocFormat("application/octet-stream", "sheet.xlsm")).toBe(
      "xlsx"
    );
    expect(resolveAnydocFormat(undefined, "legacy.xls")).toBe("xlsx");
  });

  test("maps csv from media type or extension", () => {
    expect(resolveAnydocFormat("text/csv")).toBe("csv");
    expect(resolveAnydocFormat(undefined, "data.csv")).toBe("csv");
  });
});

describe("convertDocumentBytes", () => {
  test("converts PDF fixture to markdown containing known text", async () => {
    const result = await convertDocumentBytes(SAMPLE_PDF, {
      filename: "sample.pdf",
      format: "pdf",
    });
    expect(result.truncated).toBe(false);
    expect(result.text.toLowerCase()).toContain("dummy");
  });

  test("converts XLSX fixture with known cell values", async () => {
    const result = await convertDocumentBytes(SAMPLE_XLSX, {
      filename: "sample.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.text).toContain("Widget");
    expect(result.text).toContain("42");
  });

  test("converts DOCX fixture with known heading", async () => {
    const result = await convertDocumentBytes(SAMPLE_DOCX, {
      filename: "sample.docx",
      format: "docx",
    });
    expect(result.text).toContain("Laporan");
  });

  test("converts CSV bytes when format is explicit", async () => {
    const csv = Buffer.from("name,qty\napple,2\n", "utf8");
    const result = await convertDocumentBytes(csv, { format: "csv" });
    expect(result.text).toContain("apple");
    expect(result.text).toContain("2");
  });

  test("rejects signature-less CSV bytes without a format hint", async () => {
    const csv = Buffer.from("name,qty\napple,2\n", "utf8");
    await expect(convertDocumentBytes(csv)).rejects.toThrow();
  });

  test("rejects corrupt bytes without crashing", async () => {
    await expect(
      convertDocumentBytes(Buffer.from("not-a-real-office-file"), {
        format: "xlsx",
      })
    ).rejects.toThrow();
  });

  test("truncates output above the shared UTF-8 byte limit", async () => {
    const hugeRow = "x".repeat(ANYDOC_MAX_OUTPUT_BYTES + 8192);
    const csv = Buffer.from(`col\n${hugeRow}\n`, "utf8");
    const result = await convertDocumentBytes(csv, {
      format: "csv",
      maxOutputBytes: ANYDOC_MAX_OUTPUT_BYTES,
    });
    expect(result.truncated).toBe(true);
    // Truncation may append an ellipsis after the byte cut.
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThan(
      Buffer.byteLength(hugeRow, "utf8")
    );
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
      ANYDOC_MAX_OUTPUT_BYTES + 3
    );
  });

  test("surfaces a timeout when conversion stalls", async () => {
    let observedSignal: AbortSignal | undefined;
    // The contract under test is a wall-clock budget, so the test waits on
    // the caller's own rejection rather than on a guessed duration.
    await expect(
      convertDocumentBytes(SAMPLE_XLSX, {
        convertFn: (_bytes, _format, signal) => {
          observedSignal = signal;
          return new Promise<string>((resolve) => {
            // A converter that cannot be interrupted settles once aborted.
            signal.addEventListener("abort", () => resolve("# late"), {
              once: true,
            });
          });
        },
        format: "xlsx",
        timeoutMs: 25,
      })
    ).rejects.toThrow(/timed out/i);
    expect(observedSignal?.aborted).toBe(true);
  });

  test("keeps the slot while a timed-out conversion is still running", async () => {
    const signals: AbortSignal[] = [];
    const abandoned: Array<() => void> = [];
    let inFlight = 0;
    let peakInFlight = 0;
    const calls = Array.from({ length: ANYDOC_MAX_CONCURRENT * 3 }, () =>
      convertDocumentBytes(SAMPLE_CSV, {
        convertFn: (_bytes, _format, signal) => {
          signals.push(signal);
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          return new Promise<string>((resolve) => {
            abandoned.push(() => {
              inFlight -= 1;
              resolve("# slow");
            });
          });
        },
        format: "csv",
        timeoutMs: 25,
      })
    );

    const results = await Promise.allSettled(calls);
    const outcomes = results.map((result) =>
      result.status === "fulfilled" ? "fulfilled" : String(result.reason)
    );
    expect(outcomes).toHaveLength(ANYDOC_MAX_CONCURRENT * 3);
    expect(outcomes.some((outcome) => outcome === "fulfilled")).toBe(false);
    expect(outcomes.every((outcome) => /timed out/i.test(outcome))).toBe(true);
    // Only admitted conversions ever started, and the deadline reached each
    // one of them.
    expect(peakInFlight).toBe(ANYDOC_MAX_CONCURRENT);
    expect(signals).toHaveLength(ANYDOC_MAX_CONCURRENT);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    // Callers gave up, but the abandoned work still holds both slots. A
    // wrongly freed slot would admit this caller within milliseconds, so the
    // wait below only has to outlast that.
    let started = false;
    const queued = convertDocumentBytes(SAMPLE_CSV, {
      convertFn: () => {
        started = true;
        return Promise.resolve("# next");
      },
      format: "csv",
      timeoutMs: 5000,
    });
    await Bun.sleep(20);
    expect(started).toBe(false);
    expect(inFlight).toBe(ANYDOC_MAX_CONCURRENT);

    // Capacity returns once the parser actually stops.
    while (abandoned.length > 0) {
      abandoned.shift()?.();
    }
    await expect(queued).resolves.toEqual({ text: "# next", truncated: false });
    expect(inFlight).toBe(0);
  });

  test("rejects once the queue is full instead of parking more callers", async () => {
    const held = holdingConverter();
    const call = () =>
      convertDocumentBytes(SAMPLE_CSV, {
        convertFn: held.convertFn,
        format: "csv",
        timeoutMs: 30_000,
      });
    const calls = Array.from(
      { length: ANYDOC_MAX_CONCURRENT + ANYDOC_MAX_QUEUE },
      call
    );

    await expect(call()).rejects.toThrow(/busy/i);

    held.release();
    await Promise.allSettled(calls);
  });

  test("counts the queue wait against the caller's deadline", async () => {
    const held = holdingConverter();
    const blockers = Array.from({ length: ANYDOC_MAX_CONCURRENT }, () =>
      convertDocumentBytes(SAMPLE_CSV, {
        convertFn: held.convertFn,
        format: "csv",
        timeoutMs: 30_000,
      })
    );

    let started = false;
    const queued = convertDocumentBytes(SAMPLE_CSV, {
      convertFn: () => {
        started = true;
        // Deliberately slower than the budget left once a slot frees.
        return Bun.sleep(150).then(() => "# next");
      },
      format: "csv",
      timeoutMs: 300,
    });
    expect(started).toBe(false);

    // A slot frees with only a sliver of the caller's deadline left, so the
    // conversion is cut off instead of restarting the clock.
    await Bun.sleep(200);
    held.release();

    await expect(queued).rejects.toThrow(/timed out/i);
    await Promise.allSettled(blockers);
  });
});
