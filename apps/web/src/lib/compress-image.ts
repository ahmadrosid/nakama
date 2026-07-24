import { MAX_IMAGE_BYTES } from "@nakama/core/message-content";
import { readFileAsDataUrl } from "@/lib/read-file-as-data-url";

const MAX_DIMENSION = 2048;
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4] as const;
const SCALE_STEPS = [1, 0.75, 0.5, 0.35] as const;

export function scaleImageDimensions(
  width: number,
  height: number,
  maxDimension: number,
  scale = 1,
): { width: number; height: number } {
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const longestEdge = Math.max(scaledWidth, scaledHeight);

  if (longestEdge <= maxDimension) {
    return { width: scaledWidth, height: scaledHeight };
  }

  const fitScale = maxDimension / longestEdge;
  return {
    width: Math.max(1, Math.round(scaledWidth * fitScale)),
    height: Math.max(1, Math.round(scaledHeight * fitScale)),
  };
}

function extensionForMediaType(mediaType: string, fallbackName: string): string {
  switch (mediaType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    default:
      return fallbackName.includes(".") ? (fallbackName.slice(fallbackName.lastIndexOf(".")) || ".jpg") : ".jpg";
  }
}

function renameForMediaType(filename: string, mediaType: string): string {
  const base = filename.replace(/\.[^.]+$/, "") || "image";
  return `${base}${extensionForMediaType(mediaType, filename)}`;
}

async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall back to decoding through an HTMLImageElement below.
    }
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Failed to load image."));
    element.src = dataUrl;
  });

  return createImageBitmap(image);
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mediaType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mediaType, quality);
  });
}

async function renderCompressedFile(
  bitmap: ImageBitmap,
  options: {
    filename: string;
    maxBytes: number;
    maxDimension: number;
    scale: number;
  },
): Promise<File | null> {
  const { width, height } = scaleImageDimensions(
    bitmap.width,
    bitmap.height,
    options.maxDimension,
    options.scale,
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.drawImage(bitmap, 0, 0, width, height);

  const outputTypes =
    bitmap.width > 0 && bitmap.height > 0
      ? (["image/webp", "image/jpeg"] as const)
      : (["image/jpeg"] as const);

  for (const mediaType of outputTypes) {
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, mediaType, quality);

      if (!blob || blob.size > options.maxBytes) {
        continue;
      }

      return new File([blob], renameForMediaType(options.filename, mediaType), {
        type: mediaType,
        lastModified: Date.now(),
      });
    }
  }

  return null;
}

export async function compressImageFileForUpload(
  file: File,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= maxBytes) {
    return file;
  }

  if (file.type === "image/gif") {
    return file;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await loadImageBitmap(file);

    for (const scale of SCALE_STEPS) {
      const compressed = await renderCompressedFile(bitmap, {
        filename: file.name,
        maxBytes,
        maxDimension: MAX_DIMENSION,
        scale,
      });

      if (compressed) {
        return compressed;
      }
    }

    return file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export async function prepareChatUploadFiles(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (file) => {
      if (!file.type.startsWith("image/")) {
        return file;
      }

      const compressed = await compressImageFileForUpload(file);

      if (compressed.size > MAX_IMAGE_BYTES) {
        throw new Error(
          file.type === "image/gif"
            ? "GIF images must be at most 5 MB."
            : `Could not compress "${file.name}" below 5 MB. Try a smaller image.`,
        );
      }

      return compressed;
    }),
  );
}
