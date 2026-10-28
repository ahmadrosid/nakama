const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );
}

export function extensionFor(mediaType: string): string {
  if (mediaType.includes("mp4")) {
    return "m4a";
  }

  if (mediaType.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));

    reader.onload = () => {
      const result =
        reader.result instanceof ArrayBuffer ? "" : (reader.result ?? "");

      resolve(result.slice(result.indexOf(",") + 1));
    };

    reader.readAsDataURL(blob);
  });
}

export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
