export interface TranscriptSegment {
  endMs?: number | null;
  id: string;
  receivedAt: number;
  speakerId?: string | null;
  speakerName?: string | null;
  startMs?: number | null;
  text: string;
}

export function formatTranscript(
  segments: Pick<TranscriptSegment, "text" | "speakerName">[],
  imported = false
) {
  return segments
    .map((segment) =>
      imported
        ? segment.text
        : `${segment.speakerName ? `${segment.speakerName}: ` : ""}${segment.text}\n`
    )
    .join("");
}
