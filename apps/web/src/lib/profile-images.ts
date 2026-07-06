import type { ImageAttachment } from "@nakama/core/contract";
import { parseDataUrl } from "@nakama/core/message-content";

export function fileToImageAttachment(file: File): Promise<ImageAttachment | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      resolve(result ? parseDataUrl(result) : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
