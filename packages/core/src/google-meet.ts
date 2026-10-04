export type MeetingState =
  | "queued"
  | "joining"
  | "recording"
  | "transcribing"
  | "finished"
  | "failed";
export interface Meeting {
  actorId: string;
  createdAt: number;
  durationMinutes: number;
  error: string | null;
  id: string;
  pendingSeconds?: number;
  preview?: string | null;
  profileId: string | null;
  sourceName?: string | null;
  state: MeetingState;
  stopRequested: number;
  title?: string | null;
  transcriptFile?: string;
  updatedAt: number;
  url: string;
}

export interface TranscriptSegment {
  endMs?: number | null;
  id: string;
  receivedAt: number;
  speakerId?: string | null;
  speakerName?: string | null;
  startMs?: number | null;
  text: string;
}

export type MeetAction =
  | "recordings"
  | "import-recording"
  | "upload"
  | "start-capture"
  | "meetings"
  | "status"
  | "transcript"
  | "leave"
  | "delete"
  | "configure";
export interface MeetOverview {
  canConfigure: boolean;
  captureProtocol: number;
  configured: boolean;
  enabled: boolean;
  meetings: Meeting[];
}
export interface MeetActionResults {
  configure: { configured: boolean; enabled: boolean };
  delete: { deleted: boolean };
  "import-recording": Meeting;
  leave: Meeting & { stopRequested: number };
  meetings: MeetOverview;
  recordings: {
    driveConnected: boolean;
    gmailConnected: boolean;
    recordings: {
      fileId: string;
      messageId: string;
      name: string;
      size: number;
      date: string;
    }[];
  };
  "start-capture": Meeting & { capture: { token: string; url: string } };
  status: { meeting: Meeting };
  transcript: {
    meeting: Meeting;
    segments: (TranscriptSegment & { sequence: number })[];
    nextCursor: number;
  };
  upload: Meeting;
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
