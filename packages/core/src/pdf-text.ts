export const PDF_PARSE_TIMEOUT_MS = 10_000;

export async function extractPdfText(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      parser.getText(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("PDF text extraction timed out.")),
          PDF_PARSE_TIMEOUT_MS,
        );
      }),
    ]);
    return result.text.trim();
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    await parser.destroy();
  }
}
