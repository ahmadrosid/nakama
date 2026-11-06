import { expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  parseXlsxPreview,
  XLSX_PREVIEW_MAX_BYTES,
} from "./artifact-office-preview";

function workbookFixture() {
  return {
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="r1" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      "<sst><si><t>Target tahunan</t></si><si><r><t>Gross </t></r><r><t>billing</t></r></si></sst>",
    "xl/styles.xml":
      '<styleSheet><fonts><font/><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills><fill/><fill><patternFill><fgColor rgb="FF243746"/></patternFill></fill></fills><cellXfs><xf numFmtId="0"/><xf fontId="1" fillId="1" numFmtId="3"/><xf numFmtId="9"/></cellXfs></styleSheet>',
    "xl/workbook.xml":
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Asumsi" r:id="r1"/><sheet name="KPI" r:id="r2"/></sheets></workbook>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>3000000000</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>&lt;script&gt;alert(1)&lt;/script&gt;</t></is></c><c r="B2" s="2"><f>1/2</f><v>0.5</v></c><c r="C2"><f>SUM(B1:B2)</f></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="3"><c r="C3" t="s"><v>1</v></c></row></sheetData></worksheet>',
  };
}

function bytes(parts: Record<string, string>) {
  // SAFETY: The fixture or rendered element supplies the fields consumed at this call site.
  return zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([key, value]) => [key, strToU8(value)])
    )
  ).buffer as ArrayBuffer;
}

test("reads sheet relationships, rich strings, cached formulas and basic styles", async () => {
  const result = await parseXlsxPreview(bytes(workbookFixture()));
  expect(result.sheets.map((entry) => entry.name)).toEqual(["Asumsi", "KPI"]);
  expect(result.sheets[0]?.rows[0]?.[1]).toMatchObject({
    background: "#243746",
    bold: true,
    color: "#FFFFFF",
    value: "3,000,000,000",
  });
  expect(result.sheets[0]?.rows[1]?.[1]).toMatchObject({
    formula: "=1/2",
    value: "50%",
  });
  expect(result.sheets[0]?.rows[1]?.[2]?.value).toBe("Not calculated");
  expect(result.sheets[0]?.rows[1]?.[0]?.value).toBe(
    "<script>alert(1)</script>"
  );
  expect(result.sheets[1]?.rows[2]?.[2]?.value).toBe("Gross billing");
});

test("bounds sparse rows and columns without allocating huge grids", async () => {
  const fixture = workbookFixture();
  fixture["xl/worksheets/sheet2.xml"] =
    '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row><row r="1"><c r="ZZ1"><v>1</v></c></row></sheetData></worksheet>';
  const sheet = (await parseXlsxPreview(bytes(fixture))).sheets[1]!;
  expect(sheet.truncated).toBe(true);
  expect(sheet.rows.length).toBe(1);
  expect(sheet.columns).toBe(1);
});

test("rejects external worksheet links, XML entities, oversized and non-workbook files", async () => {
  const fixture = workbookFixture();
  fixture["xl/_rels/workbook.xml.rels"] =
    '<Relationships><Relationship Id="r1" TargetMode="External" Target="https://example.com/test.xml"/></Relationships>';
  await expect(parseXlsxPreview(bytes(fixture))).rejects.toThrow();
  const entity = workbookFixture();
  entity["xl/sharedStrings.xml"] = "<!DOCTYPE foo><sst/>";
  await expect(parseXlsxPreview(bytes(entity))).rejects.toThrow();
  await expect(
    parseXlsxPreview(new ArrayBuffer(XLSX_PREVIEW_MAX_BYTES + 1))
  ).rejects.toThrow();
  await expect(
    parseXlsxPreview(bytes({ "text.txt": "Hello" }))
  ).rejects.toThrow();
});

test("rejects highly compressed oversized XML before expansion", async () => {
  const fixture = workbookFixture();
  fixture["xl/sharedStrings.xml"] = " ".repeat(25 * 1024 * 1024);
  await expect(parseXlsxPreview(bytes(fixture))).rejects.toThrow();
});

test("expands a large allowed XML entry with the asynchronous unzip path", async () => {
  const fixture = workbookFixture();
  fixture["xl/sharedStrings.xml"] =
    `<sst><si><t>${"x".repeat(600_000)}</t></si></sst>`;
  const result = await parseXlsxPreview(bytes(fixture));
  expect(result.sheets[0]?.rows[0]?.[0]?.value.length).toBe(600_000);
  expect(result.sheets[0]?.rows[0]?.[1]?.value).toBe("3,000,000,000");
});

test("uses the workbook date system and tolerates invalid numeric dates", async () => {
  const fixture = workbookFixture();
  fixture["xl/workbook.xml"] = fixture["xl/workbook.xml"].replace(
    "<sheets>",
    '<workbookPr date1904="1"/><sheets>'
  );
  fixture["xl/styles.xml"] = fixture["xl/styles.xml"].replace(
    "</cellXfs>",
    '<xf numFmtId="14"/></cellXfs>'
  );
  fixture["xl/worksheets/sheet2.xml"] =
    '<worksheet><sheetData><row r="1"><c r="A1" s="3"><v>0</v></c><c r="B1" s="3"><v>1e20</v></c></row></sheetData></worksheet>';
  const sheet = (await parseXlsxPreview(bytes(fixture))).sheets[1]!;
  expect(sheet.rows[0]?.[0]?.value).toBe("1904-01-01");
  expect(sheet.rows[0]?.[1]?.value).toBe("1e20");
});

test("skips chart sheets while keeping worksheets and refusing unsafe targets", async () => {
  const fixture = workbookFixture();
  fixture["xl/_rels/workbook.xml.rels"] = fixture[
    "xl/_rels/workbook.xml.rels"
  ].replace("worksheets/sheet2.xml", "chartsheets/sheet2.xml");
  expect(
    (await parseXlsxPreview(bytes(fixture))).sheets.map((sheet) => sheet.name)
  ).toEqual(["Asumsi"]);
  fixture["xl/_rels/workbook.xml.rels"] = fixture[
    "xl/_rels/workbook.xml.rels"
  ].replace("chartsheets/sheet2.xml", "../chartsheets/sheet2.xml");
  await expect(parseXlsxPreview(bytes(fixture))).rejects.toThrow();
});

test("infers omitted row and cell references after explicit positions", async () => {
  const fixture = workbookFixture();
  fixture["xl/worksheets/sheet2.xml"] =
    '<worksheet><sheetData><row><c><v>1</v></c><c><v>2</v></c></row><row r="4"><c r="C4"><v>3</v></c><c><v>4</v></c></row><row><c><v>5</v></c></row></sheetData></worksheet>';
  const sheet = (await parseXlsxPreview(bytes(fixture))).sheets[1]!;
  expect(sheet.rows[0]?.[0]?.value).toBe("1");
  expect(sheet.rows[0]?.[1]?.value).toBe("2");
  expect(sheet.rows[3]?.[2]?.value).toBe("3");
  expect(sheet.rows[3]?.[3]?.value).toBe("4");
  expect(sheet.rows[4]?.[0]?.value).toBe("5");
});

test("formats custom dates, built-in times and date-time cached values", async () => {
  const fixture = workbookFixture();
  fixture["xl/styles.xml"] =
    '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><cellXfs><xf numFmtId="164"/><xf numFmtId="18"/><xf numFmtId="21"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  fixture["xl/worksheets/sheet2.xml"] =
    '<worksheet><sheetData><row><c s="0"><v>45292</v></c><c s="1"><v>0.5</v></c><c s="2"><v>0.5</v></c><c s="3"><v>45292.5</v></c></row></sheetData></worksheet>';
  const sheet = (await parseXlsxPreview(bytes(fixture))).sheets[1]!;
  expect(sheet.rows[0]?.[0]?.value).toBe("2024-01-01");
  expect(sheet.rows[0]?.[1]?.value).toBe("12:00 PM");
  expect(sheet.rows[0]?.[2]?.value).toBe("12:00:00");
  expect(sheet.rows[0]?.[3]?.value).toBe("2024-01-01 12:00:00");
});
