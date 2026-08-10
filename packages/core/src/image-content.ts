import type { ChatMessage, MessageContentPart } from "./contract";

export const IMAGE_VISION_SYSTEM_PROMPT =
  "Describe the image in detail for another AI that cannot see it. Include visible text, UI elements, diagrams, colors, layout, and any other relevant context. Be concise but complete.";

export const IMAGE_DESCRIPTION_PREFIX = "[Image]\n";

export function extractImageParts(
  content: string | MessageContentPart[]
): Extract<MessageContentPart, { type: "image" }>[] {
  if (typeof content === "string") {
    return [];
  }

  return content.filter(
    (part): part is Extract<MessageContentPart, { type: "image" }> =>
      part.type === "image"
  );
}

export function formatImageDescriptionText(description: string): string {
  return `${IMAGE_DESCRIPTION_PREFIX}${description.trim()}`;
}

export function isImageDescriptionText(text: string): boolean {
  return text.startsWith(IMAGE_DESCRIPTION_PREFIX);
}

export function parseImageDescriptionText(text: string): string | null {
  if (!isImageDescriptionText(text)) {
    return null;
  }

  return text.slice(IMAGE_DESCRIPTION_PREFIX.length).trim() || null;
}

export function replaceImagePartsWithDescriptions(
  content: string | MessageContentPart[],
  descriptions: string[]
): string | MessageContentPart[] {
  if (typeof content === "string") {
    if (descriptions.length === 0) {
      return content;
    }

    return descriptions
      .map((description) => formatImageDescriptionText(description))
      .join("\n\n");
  }

  const parts: MessageContentPart[] = [];
  let descriptionIndex = 0;

  for (const part of content) {
    if (part.type === "image") {
      const description = descriptions[descriptionIndex]?.trim();

      if (!description) {
        throw new Error("Missing image description for image part.");
      }

      parts.push({
        ...part,
        description,
      });
      descriptionIndex += 1;
      continue;
    }

    parts.push(part);
  }

  if (descriptionIndex !== descriptions.length) {
    throw new Error("Image description count does not match image parts.");
  }

  return parts;
}

export function resolveUserContentForNonVisionProvider(
  content: string | MessageContentPart[]
): string | MessageContentPart[] {
  if (typeof content === "string") {
    return content;
  }

  const parts: MessageContentPart[] = [];

  for (const part of content) {
    if (part.type === "image" && part.description?.trim()) {
      parts.push({
        text: formatImageDescriptionText(part.description),
        type: "text",
      });
      continue;
    }

    parts.push(part);
  }

  return parts.length === 1 && parts[0]?.type === "text"
    ? parts[0].text
    : parts;
}

export function resolveMessagesForNonVisionProvider(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") {
      return message;
    }

    return {
      ...message,
      content: resolveUserContentForNonVisionProvider(message.content),
    };
  });
}
