import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANYDOC_TIMEOUT_MS,
  convertDocumentBytes,
  resolveAnydocFormat,
} from "./anydoc-text";
import { ANYDOC_MAX_OUTPUT_BYTES } from "./anydoc-text";

const FIXTURES = join(import.meta.dir, "__fixtures__");
const SAMPLE_PDF = readFileSync(join(FIXTURES, "sample.pdf"));
const SAMPLE_XLSX = readFileSync(join(FIXTURES, "sample.xlsx"));
const SAMPLE_DOCX = readFileSync(join(FIXTURES, "sample.docx"));

describe("resolveAnydocFormat", () => {
  test("maps spreadsheet media types and extensions to xlsx", () => {
    expect(
      resolveAnydocFormat(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "budget.bin",
      ),
    ).toBe("xlsx");
    expect(resolveAnydocFormat("application/octet-stream", "sheet.xlsm")).toBe(
      "xlsx",
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
      format: "pdf",
      filename: "sample.pdf",
    });
    expect(result.truncated).toBe(false);
    expect(result.text.toLowerCase()).toContain("dummy");
  });

  test("converts XLSX fixture with known cell values", async () => {
    const result = await convertDocumentBytes(SAMPLE_XLSX, {
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "sample.xlsx",
    });
    expect(result.text).toContain("Widget");
    expect(result.text).toContain("42");
  });

  test("converts DOCX fixture with known heading", async () => {
    const result = await convertDocumentBytes(SAMPLE_DOCX, {
      format: "docx",
      filename: "sample.docx",
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
      }),
    ).rejects.toThrow();
  });

  test("truncates output above the shared UTF-8 byte limit", async () => {
    const hugeRow = "x".repeat(ANYDOC_MAX_OUTPUT_BYTES + 8_192);
    const csv = Buffer.from(`col\n${hugeRow}\n`, "utf8");
    const result = await convertDocumentBytes(csv, {
      format: "csv",
      maxOutputBytes: ANYDOC_MAX_OUTPUT_BYTES,
    });
    expect(result.truncated).toBe(true);
    // Truncation may append an ellipsis after the byte cut.
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThan(
      Buffer.byteLength(hugeRow, "utf8"),
    );
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
      ANYDOC_MAX_OUTPUT_BYTES + 3,
    );
  });

  test("surfaces a timeout when conversion stalls", async () => {
    await expect(
      convertDocumentBytes(SAMPLE_XLSX, {
        format: "xlsx",
        timeoutMs: 25,
        convertFn: () =>
          new Promise<string>(() => {
            /* never resolves */
          }),
      }),
    ).rejects.toThrow(/timed out/i);

    expect(ANYDOC_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
