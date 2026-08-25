/** Trigger a browser download for an in-memory archive. */
export function downloadArchive(filename: string, data: ArrayBuffer): void {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/zip" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
