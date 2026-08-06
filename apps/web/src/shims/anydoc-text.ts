/** Browser stub — document conversion runs on the server only. */

export type AnydocFormat = string;

export interface AnydocConvertResult {
  text: string;
  truncated: boolean;
}

export async function convertDocumentBytes(): Promise<AnydocConvertResult> {
  throw new Error("Document conversion is not available in the web client.");
}

export function resolveAnydocFormat(): null {
  return null;
}
