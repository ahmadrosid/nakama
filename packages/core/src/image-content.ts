import type { MessageContentPart } from "./contract";

export const IMAGE_VISION_SYSTEM_PROMPT =
  "Describe the image in detail for another AI that cannot see it. Include visible text, UI elements, diagrams, colors, layout, and any other relevant context. Be concise but complete.";

export function extractImageParts(
  content: string | MessageContentPart[],
): Extract<MessageContentPart, { type: "image" }>[] {
  if (typeof content === "string") {
    return [];
  }

  return content.filter(
    (part): part is Extract<MessageContentPart, { type: "image" }> =>
      part.type === "image",
  );
}

export function replaceImagePartsWithDescriptions(
  content: string | MessageContentPart[],
  descriptions: string[],
): string | MessageContentPart[] {
  if (typeof content === "string") {
    if (descriptions.length === 0) {
      return content;
    }

    return descriptions
      .map((description) => `[Image]\n${description.trim()}`)
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
        type: "text",
        text: `[Image]\n${description}`,
      });
      descriptionIndex += 1;
      continue;
    }

    parts.push(part);
  }

  if (descriptionIndex !== descriptions.length) {
    throw new Error("Image description count does not match image parts.");
  }

  return parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts;
}
