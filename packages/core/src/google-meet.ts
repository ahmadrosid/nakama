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
  | "import-progress"
  | "upload"
  | "start-capture"
  | "meetings"
  | "status"
  | "transcript"
  | "leave"
  | "delete"
  | "configure"
  | "approve-extension"
  | "revoke-extension"
  | "extension-keys";

/** Actions a browser session can call. Only a Meet key starts a capture. */
export type MeetSessionAction = Exclude<MeetAction, "start-capture">;

export interface MeetActionInput {
  after?: number;
  code?: string;
  content?: string;
  enabled?: boolean;
  fileId?: string;
  filename?: string;
  keyId?: string;
  meetingId?: string;
  messageId?: string;
}

/** A browser paired with the Google Meet extension. The key itself is never returned. */
export interface MeetExtensionKey {
  createdAt: number;
  expiresAt: number;
  id: string;
  label: string;
  lastUsedAt: number | null;
}

export interface MeetImportProgress {
  /** Bytes of the recording downloaded so far. */
  bytes?: number;
  part?: number;
  parts?: number;
  step: "download" | "extract" | "transcribe" | "save";
  totalBytes?: number;
}

export interface MeetOverview {
  canConfigure: boolean;
  /** Uploads and imports can be transcribed. */
  configured: boolean;
  enabled: boolean;
  /** Live calls need an OpenAI key for speaker labels. */
  liveReady: boolean;
  meetings: Meeting[];
  /** The workspace transcription model, when one is set. */
  transcription: { model: string; type: string } | null;
  transcriptionError: string | null;
}

export interface MeetActionResults {
  "approve-extension": MeetExtensionKey;
  configure: { configured: boolean; enabled: boolean };
  delete: { deleted: boolean };
  "extension-keys": { keys: MeetExtensionKey[] };
  "import-progress": { progress: MeetImportProgress | null };
  "import-recording": Meeting;
  leave: Meeting & { stopRequested: number };
  meetings: MeetOverview;
  recordings: {
    composioConfigured: boolean;
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
  "revoke-extension": { revoked: boolean };
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
