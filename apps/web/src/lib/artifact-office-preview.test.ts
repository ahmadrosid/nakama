import { expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import {
  parseDocxPreview,
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

test("inline Word preview reads paragraphs without executing embedded content", () => {
  const data = bytes({
    "word/document.xml":
      '<w:document xmlns:w="urn:test"><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Notes</w:t></w:r></w:p><w:p><w:r><w:t>Read only</w:t></w:r></w:p></w:document>',
  });

  expect(parseDocxPreview(data)).toBe("# Notes\n\nRead only");
  expect(() =>
    parseDocxPreview(
      bytes({ "word/document.xml": "<!DOCTYPE foo><w:document/>" })
    )
  ).toThrow();
});

function bytes(parts: Record<string, string>) {
  // SAFETY: The fixture or rendered element supplies the fields consumed at this call site.
  return zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([key, value]) => [key, strToU8(value)])
    )
  ).buffer as ArrayBuffer;
}

test("reads sheet relationships, rich strings, cached formulas and basic styles", () => {
  const result = parseXlsxPreview(bytes(workbookFixture()));
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

test("bounds sparse rows and columns without allocating huge grids", () => {
  const fixture = workbookFixture();
  fixture["xl/worksheets/sheet2.xml"] =
    '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row><row r="1"><c r="ZZ1"><v>1</v></c></row></sheetData></worksheet>';
  const sheet = parseXlsxPreview(bytes(fixture)).sheets[1]!;
  expect(sheet.truncated).toBe(true);
  expect(sheet.rows.length).toBe(1);
  expect(sheet.columns).toBe(1);
});

test("rejects external worksheet links, XML entities, oversized and non-workbook files", () => {
  const fixture = workbookFixture();
  fixture["xl/_rels/workbook.xml.rels"] =
    '<Relationships><Relationship Id="r1" TargetMode="External" Target="https://example.com/test.xml"/></Relationships>';
  expect(() => parseXlsxPreview(bytes(fixture))).toThrow();
  const entity = workbookFixture();
  entity["xl/sharedStrings.xml"] = "<!DOCTYPE foo><sst/>";
  expect(() => parseXlsxPreview(bytes(entity))).toThrow();
  expect(() =>
    parseXlsxPreview(new ArrayBuffer(XLSX_PREVIEW_MAX_BYTES + 1))
  ).toThrow();
  expect(() => parseXlsxPreview(bytes({ "text.txt": "Hello" }))).toThrow();
});

test("rejects highly compressed oversized XML before expansion", () => {
  const fixture = workbookFixture();
  fixture["xl/sharedStrings.xml"] = " ".repeat(25 * 1024 * 1024);
  expect(() => parseXlsxPreview(bytes(fixture))).toThrow("expanded workbook");
});

test("uses the workbook date system and tolerates invalid numeric dates", () => {
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
  const sheet = parseXlsxPreview(bytes(fixture)).sheets[1]!;
  expect(sheet.rows[0]?.[0]?.value).toBe("1904-01-01");
  expect(sheet.rows[0]?.[1]?.value).toBe("1e20");
});
