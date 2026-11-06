import { unzipSync } from "fflate";

export const XLSX_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

const XLSX_PREVIEW_MAX_ROWS = 500;

const XLSX_PREVIEW_MAX_COLUMNS = 50;

interface WorkbookCell {
  background?: string;
  bold?: boolean;
  color?: string;
  formula?: string;
  value: string;
}

interface WorkbookSheet {
  columns: number;
  name: string;
  rows: Record<number, WorkbookCell>[];
  truncated: boolean;
}

export interface WorkbookPreview {
  sheets: WorkbookSheet[];
}

function nodes(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(
    (entry) => entry.localName === name
  );
}

function xml(bytes: Uint8Array | undefined): Document {
  if (!bytes) {
    throw new Error("The workbook is missing a required XML part.");
  }

  const source = new TextDecoder().decode(bytes);

  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error("Unsupported workbook XML declarations.");
  }

  const document = new window.DOMParser().parseFromString(
    source,
    "application/xml"
  );

  if (nodes(document, "parsererror").length) {
    throw new Error("The workbook contains invalid XML.");
  }

  return document;
}

function rgb(node: Element | undefined): string | undefined {
  const value = node?.getAttribute("rgb");

  return value && /^(?:[\dA-F]{2})?[\dA-F]{6}$/i.test(value)
    ? `#${value.slice(-6)}`
    : undefined;
}

function displayNumber(
  raw: string,
  format: string,
  formatId: number,
  date1904: boolean
): string {
  const value = Number(raw);

  if (!Number.isFinite(value) || raw === "") {
    return raw;
  }

  if (formatId >= 14 && formatId <= 22) {
    const date = new Date(
      (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) +
        (value + (!date1904 && value > 0 && value < 60 ? 1 : 0)) * 86_400_000
    );

    return Number.isNaN(date.getTime()) ? raw : date.toISOString().slice(0, 10);
  }

  if (format === "General" || !format) {
    return raw;
  }

  const precision = Math.min(10, format.match(/\.([0#]+)/)?.[1]?.length ?? 0);
  const percent = format.includes("%");

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
    style: percent ? "percent" : "decimal",
    useGrouping: format.includes(","),
  }).format(value);
}

/** Read paragraphs from a fresh inline DOCX without running embedded content. */
export function parseDocxPreview(data: ArrayBuffer): string {
  if (data.byteLength > XLSX_PREVIEW_MAX_BYTES) {
    throw new Error(
      "This file exceeds the 8 MB preview limit. Download it instead."
    );
  }

  const bytes = new Uint8Array(data);

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  }

  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name !== "word/document.xml") {
        return false;
      }

      if (file.originalSize > 24 * 1024 * 1024) {
        throw new Error(
          "The expanded document exceeds the preview limit. Download it instead."
        );
      }

      return true;
    },
  });

  return nodes(xml(files["word/document.xml"]), "p")
    .map((paragraph) => {
      const text = nodes(paragraph, "t")
        .map((run) => run.textContent ?? "")
        .join("");

      const style = nodes(paragraph, "pStyle")[0]?.getAttribute("w:val") ?? "";
      const heading = /^Heading([1-6])$/i.exec(style);

      return heading ? `${"#".repeat(Number(heading[1]))} ${text}` : text;
    })
    .join("\n\n");
}

/** Read cached values only. Formulas, links and macros are never executed. */
export function parseXlsxPreview(data: ArrayBuffer): WorkbookPreview {
  if (data.byteLength > XLSX_PREVIEW_MAX_BYTES) {
    throw new Error(
      "This workbook exceeds the 8 MB preview limit. Download it to view all data."
    );
  }

  let expandedBytes = 0;

  const files = unzipSync(new Uint8Array(data), {
    filter: (file) => {
      if (
        !/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(
          file.name
        )
      ) {
        return false;
      }

      expandedBytes += file.originalSize;

      if (expandedBytes > 24 * 1024 * 1024) {
        throw new Error(
          "The expanded workbook exceeds the preview limit. Download it instead."
        );
      }

      return true;
    },
  });

  const workbook = xml(files["xl/workbook.xml"]);

  const date1904 = ["1", "true"].includes(
    nodes(workbook, "workbookPr")[0]?.getAttribute("date1904") ?? ""
  );

  const relationships = new Map(
    nodes(xml(files["xl/_rels/workbook.xml.rels"]), "Relationship")
      .filter((entry) => entry.getAttribute("TargetMode") !== "External")
      .map((entry) => [
        entry.getAttribute("Id"),
        entry.getAttribute("Target") ?? "",
      ])
  );

  const strings = files["xl/sharedStrings.xml"]
    ? nodes(xml(files["xl/sharedStrings.xml"]), "si").map((entry) =>
        nodes(entry, "t")
          .map((text) => text.textContent ?? "")
          .join("")
      )
    : [];

  const styles = files["xl/styles.xml"] ? xml(files["xl/styles.xml"]) : null;
  const fonts = styles ? nodes(styles, "font") : [];
  const fills = styles ? nodes(styles, "fill") : [];

  const formats = new Map(
    styles
      ? nodes(styles, "numFmt").map((entry) => [
          Number(entry.getAttribute("numFmtId")),
          entry.getAttribute("formatCode") ?? "General",
        ])
      : []
  );

  const builtins = new Map<number, string>([
    [1, "0"],
    [2, "0.00"],
    [3, "#,##0"],
    [4, "#,##0.00"],
    [9, "0%"],
    [10, "0.00%"],
  ]);

  const cellStyles = styles
    ? Array.from(nodes(styles, "cellXfs")[0]?.children ?? [])
    : [];

  const definitions = nodes(workbook, "sheet");

  if (!definitions.length || definitions.length > 32) {
    throw new Error(
      "Preview supports workbooks with 1–32 sheets. Download this file instead."
    );
  }

  const sheets = definitions.map((definition): WorkbookSheet => {
    const id =
      definition.getAttribute("r:id") ??
      definition.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id"
      );

    const target = relationships.get(id) ?? "";

    const filename = target.startsWith("/xl/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;

    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(filename)) {
      throw new Error("Unsupported worksheet location.");
    }

    const source = xml(files[filename]);
    const rows: WorkbookSheet["rows"] = [];
    let columns = 1;
    let truncated = false;

    for (const row of nodes(source, "row")) {
      const rowIndex = Number(row.getAttribute("r")) - 1;

      if (!Number.isInteger(rowIndex) || rowIndex < 0) {
        continue;
      }

      if (rowIndex >= XLSX_PREVIEW_MAX_ROWS) {
        truncated = true;
        continue;
      }

      rows[rowIndex] = {};

      for (const cell of nodes(row, "c")) {
        const reference = cell.getAttribute("r") ?? "";
        const letters = reference.match(/^([A-Z]+)\d+$/)?.[1];

        if (!letters) {
          continue;
        }

        let index = 0;

        for (const letter of letters) {
          index = index * 26 + letter.charCodeAt(0) - 64;
        }

        if (index > XLSX_PREVIEW_MAX_COLUMNS) {
          truncated = true;
          continue;
        }

        columns = Math.max(columns, index);
        const type = cell.getAttribute("t");
        const raw = nodes(cell, "v")[0]?.textContent ?? "";
        const formula = nodes(cell, "f")[0]?.textContent ?? undefined;
        const style = cellStyles[Number(cell.getAttribute("s") ?? 0)];
        const font = fonts[Number(style?.getAttribute("fontId") ?? 0)];
        const fill = fills[Number(style?.getAttribute("fillId") ?? 0)];
        const formatId = Number(style?.getAttribute("numFmtId") ?? 0);
        let value = raw;

        if (type === "s") {
          value = strings[Number(raw)] ?? "";
        } else if (type === "inlineStr") {
          value = nodes(cell, "t")
            .map((entry) => entry.textContent ?? "")
            .join("");
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else if (!type || type === "n") {
          value = displayNumber(
            raw,
            formats.get(formatId) ?? builtins.get(formatId) ?? "General",
            formatId,
            date1904
          );
        }

        rows[rowIndex][index - 1] = {
          background: fill ? rgb(nodes(fill, "fgColor")[0]) : undefined,
          bold: font
            ? nodes(font, "b").some(
                (entry) => entry.getAttribute("val") !== "0"
              )
            : false,
          color: font ? rgb(nodes(font, "color")[0]) : undefined,
          formula: formula ? `=${formula}` : undefined,
          value: formula && raw === "" ? "Not calculated" : value,
        };
      }
    }

    return {
      columns,
      name: definition.getAttribute("name") ?? "Sheet",
      rows,
      truncated,
    };
  });

  return { sheets };
}
