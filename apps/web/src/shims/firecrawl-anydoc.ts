/** Browser stub for the native anydoc package. */

export async function toMarkdownBytes(): Promise<string> {
  throw new Error("Document conversion is not available in the web client.");
}

export async function toMarkdown(): Promise<string> {
  throw new Error("Document conversion is not available in the web client.");
}

export async function toDocument(): Promise<never> {
  throw new Error("Document conversion is not available in the web client.");
}
