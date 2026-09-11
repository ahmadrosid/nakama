import type { ImageAttachment } from "@nakama/core/contract";
import { parseDataUrl } from "@nakama/core/message-content";

import { readFileAsDataUrl } from "./read-file-as-data-url";

export function fileToImageAttachment(
  file: File
): Promise<ImageAttachment | null> {
  return readFileAsDataUrl(file).then(parseDataUrl, () => null);
}
