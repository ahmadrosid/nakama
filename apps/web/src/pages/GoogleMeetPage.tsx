import {
  formatTranscript,
  type MeetAction,
  type MeetActionInput,
  type MeetActionResults,
  type MeetImportProgress,
  type Meeting,
  type MeetOverview as Overview,
  type TranscriptSegment,
} from "@nakama/core/google-meet";
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@nakama/ui";
import { buttonVariants } from "@nakama/ui/button-variants";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  Mic01Icon,
  Search01Icon,
  Settings01Icon,
  StopIcon,
  Tick02Icon,
  Upload01Icon,
  Video01Icon,
} from "hugeicons-react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { isAllowedComposioRedirectUrl } from "@/hooks/use-composio";
import { client, formatError } from "@/lib/client";

type MeetCall = <Action extends MeetAction>(
  action: Action,
  input?: MeetActionInput,
  signal?: AbortSignal
) => Promise<MeetActionResults[Action]>;

function meetingStatus(meeting: Meeting) {
  if (
    ["queued", "joining", "recording", "transcribing"].includes(meeting.state)
  ) {
    if ((meeting.pendingSeconds ?? 0) > 30) {
      return "Transcription is catching up…";
    }

    if (meeting.state === "recording") {
      return meeting.stopRequested
        ? "Stopping…"
        : "Recording and transcribing…";
    }

    return meeting.stopRequested
      ? "Stopping…"
      : meeting.state === "transcribing"
        ? "Finishing transcript…"
        : "Connecting…";
  }

  if (meeting.state === "failed") {
    return meeting.transcriptFile
      ? "Partial transcript"
      : "Transcription failed";
  }

  return meeting.transcriptFile ? "Transcript ready" : "No speech captured";
}

function isActive(meeting: Meeting) {
  return ["queued", "joining", "recording", "transcribing"].includes(
    meeting.state
  );
}

function statusTone(meeting: Meeting) {
  if (meeting.state === "failed") {
    return meeting.transcriptFile ? "warning" : "danger";
  }

  return meeting.transcriptFile ? "success" : "muted";
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const pad = (value: number) => String(value).padStart(2, "0");

  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${pad(minutes)}:${pad(seconds % 60)}`;
}

function meetingLength(meeting: Meeting) {
  if (meeting.sourceName) {
    return "Uploaded";
  }

  const minutes = Math.round((meeting.updatedAt - meeting.createdAt) / 60_000);

  return minutes < 1 ? "Under 1 min" : `${minutes} min`;
}

function useTranscriptSegments(
  call: MeetCall,
  signal: AbortSignal,
  meetingId: string
) {
  const [segments, setSegments] = React.useState<TranscriptSegment[]>([]);
  const [error, setError] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    let cursor = 0;
    let running = false;

    function refresh() {
      if (!alive || running || signal.aborted) {
        return;
      }

      running = true;
      void call("transcript", {
        after: cursor,
        meetingId,
      })
        .then((result) => {
          if (alive && !signal.aborted) {
            cursor = result.nextCursor;
            setSegments((previous) => {
              const seen = new Set(previous.map((segment) => segment.id));

              return [
                ...previous,
                ...result.segments.filter((segment) => !seen.has(segment.id)),
              ];
            });
            setError("");
            setLoaded(true);
          }
        })
        .catch((reason) => {
          if (alive && !signal.aborted) {
            setError(formatError(reason));
          }
        })
        .finally(() => {
          running = false;
        });
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 2000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [meetingId, call, signal]);

  return { error, loaded, segments };
}

function Settings({
  close,
  configured,
  enabled: initialEnabled,
  call,
}: {
  close(): void;
  configured: boolean;
  enabled: boolean;
  call: MeetCall;
}) {
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await call("configure", { enabled });
      close();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Google Meet integration</DialogTitle>
          <DialogDescription>
            Enable transcription for your Google Meet calls.
          </DialogDescription>
        </DialogHeader>
        <form className="meet-form" onSubmit={save}>
          <label className="meet-enable" htmlFor="meet-enabled">
            <img alt="" height={32} src="/icons/google-meet.png" width={32} />
            <span className="meet-enable-copy">Enable Google Meet</span>
            <Switch
              checked={enabled}
              className={enabled ? "bg-blue-600" : undefined}
              disabled={busy}
              id="meet-enabled"
              onCheckedChange={setEnabled}
            />
          </label>
          {!configured && (
            <p className="meet-status">
              Add an OpenAI provider in{" "}
              <a href="/customize/providers">AI Providers</a> to transcribe
              meetings.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={close}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Transcript({
  meeting,
  close,
  call,
  signal,
  onDelete,
}: {
  meeting: Meeting;
  close(): void;
  call: MeetCall;
  signal: AbortSignal;
  onDelete(meeting: Meeting): void;
}) {
  const { error, loaded, segments } = useTranscriptSegments(
    call,
    signal,
    meeting.id
  );

  const text = formatTranscript(segments, Boolean(meeting.sourceName));
  const [copyStatus, setCopyStatus] = React.useState("");
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => heading.current?.focus(), []);

  function download() {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = meeting.sourceName
      ? `${meeting.sourceName.replace(/\.[^.]+$/, "")}.txt`
      : `meeting-${new Date(meeting.createdAt).toISOString().slice(0, 10)}-${meeting.url.split("/").pop()}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="meet-detail">
      <div>
        <Button onClick={close} size="sm" variant="ghost">
          ← Back
        </Button>
      </div>
      <div className="meet-detail-heading">
        <div className="meet-meta">
          <h2 ref={heading} tabIndex={-1}>
            {meeting.title || meeting.sourceName || "Meeting transcript"}
          </h2>
          <span className="meet-status">
            {new Date(meeting.createdAt).toLocaleString(undefined, {
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </span>
          {meeting.state !== "finished" && (
            <span className="meet-status" role="status">
              {meetingStatus(meeting)}
            </span>
          )}
        </div>
        <div className="meet-row">
          <Button
            aria-label="Copy transcript"
            disabled={!text}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopyStatus("Transcript copied");
              } catch {
                setCopyStatus(
                  "Could not copy. Select the text to copy it, or download it."
                );
              }
            }}
            size="icon"
            title="Copy transcript"
            variant="ghost"
          >
            <Copy01Icon aria-hidden="true" size={16} />
          </Button>
          <Button
            aria-label="Download transcript"
            disabled={!text}
            onClick={download}
            size="icon"
            title="Download transcript"
            variant="ghost"
          >
            <Download01Icon aria-hidden="true" size={16} />
          </Button>
          {!isActive(meeting) && (
            <Button
              aria-label="Delete meeting"
              className="meet-delete"
              onClick={() => onDelete(meeting)}
              size="icon"
              title="Delete meeting"
              variant="ghost"
            >
              <Delete02Icon aria-hidden="true" size={16} />
            </Button>
          )}
        </div>
      </div>
      {copyStatus && (
        <span className="meet-status" role="status">
          {copyStatus}
        </span>
      )}
      {error && <p role="alert">{error}</p>}
      {text ? (
        <Card className="meet-card meet-document">
          <div className="meet-document-text">
            {meeting.sourceName
              ? text
              : segments.map((segment) => (
                  <p key={segment.id}>
                    <strong>{segment.speakerName || "Unknown speaker"}</strong>
                    {"\n"}
                    {segment.text}
                  </p>
                ))}
          </div>
        </Card>
      ) : (
        <Card className="meet-card">
          <p className="meet-empty" role="status">
            {loaded
              ? isActive(meeting)
                ? "Waiting for speech…"
                : "No speech was captured."
              : "Loading transcript…"}
          </p>
        </Card>
      )}
    </section>
  );
}

function LiveMeeting({
  meeting,
  busy,
  call,
  signal,
  onStop,
  onOpen,
}: {
  meeting: Meeting;
  busy: boolean;
  call: MeetCall;
  signal: AbortSignal;
  onStop(meetingId: string): void;
  onOpen(meeting: Meeting): void;
}) {
  const { segments } = useTranscriptSegments(call, signal, meeting.id);
  const [now, setNow] = React.useState(Date.now);

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  const label =
    meeting.state === "recording" && !meeting.stopRequested
      ? `Recording · ${formatElapsed(now - meeting.createdAt)}`
      : meetingStatus(meeting);

  return (
    <Card className="meet-card">
      <div className="meet-live-heading">
        <div className="meet-meta">
          <span className="meet-live-status" role="status">
            <span aria-hidden="true" className="meet-live-dot" />
            {label}
          </span>
          <h2 className="meet-live-title">
            {meeting.title || "Untitled meeting"}
          </h2>
          <span className="meet-status">{meeting.url}</span>
        </div>
        <div className="meet-row">
          <Button onClick={() => onOpen(meeting)}>Open transcript</Button>
          <Button
            disabled={
              busy ||
              !!meeting.stopRequested ||
              meeting.state === "transcribing"
            }
            onClick={() => onStop(meeting.id)}
            variant="outline"
          >
            <StopIcon aria-hidden="true" size={14} />
            Stop
          </Button>
        </div>
      </div>
      <div className="meet-live-preview">
        {segments.slice(-2).map((segment) => (
          <p key={segment.id}>
            <strong>{segment.speakerName || "Unknown speaker"}</strong>{" "}
            {segment.text}
          </p>
        ))}
        <span className="meet-status meet-listening">
          <Mic01Icon aria-hidden="true" size={14} />
          Listening…
        </span>
        {meeting.error && <p role="alert">{meeting.error}</p>}
      </div>
      <p className="meet-live-warning">
        <AlertCircleIcon aria-hidden="true" size={14} />
        Keep this tab open until the call ends.
      </p>
    </Card>
  );
}

function MeetingRow({
  meeting,
  onOpen,
}: {
  meeting: Meeting;
  onOpen(meeting: Meeting): void;
}) {
  return (
    <li>
      <button
        className="meet-meeting"
        onClick={() => onOpen(meeting)}
        type="button"
      >
        <span className="meet-meta">
          <span className="meet-meeting-title">
            {meeting.title || meeting.sourceName || "Untitled meeting"}
          </span>
          <span className="meet-status">
            {new Date(meeting.createdAt).toLocaleString(undefined, {
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              month: "short",
            })}
            {" · "}
            {meetingLength(meeting)}
          </span>
        </span>
        <span className="meet-badge" data-tone={statusTone(meeting)}>
          {meetingStatus(meeting)}
        </span>
        <ArrowRight01Icon
          aria-hidden="true"
          className="meet-chevron"
          size={16}
        />
      </button>
      {meeting.error && <p role="alert">{meeting.error}</p>}
    </li>
  );
}

function MeetingHistory({
  meetings,
  onOpen,
}: {
  meetings: Meeting[];
  onOpen(meeting: Meeting): void;
}) {
  const [query, setQuery] = React.useState("");
  const search = query.trim().toLowerCase();

  const history = meetings.filter(
    (meeting) =>
      !isActive(meeting) &&
      (meeting.title || meeting.sourceName || "Untitled meeting")
        .toLowerCase()
        .includes(search)
  );

  return (
    <Card className="meet-card">
      <div className="meet-card-heading">
        <h2>Meeting history</h2>
        <label className="meet-search">
          <Search01Icon aria-hidden="true" size={14} />
          <input
            aria-label="Search meetings"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search meetings"
            type="search"
            value={query}
          />
        </label>
      </div>
      {history.length ? (
        <ul className="meet-list">
          {history.map((meeting) => (
            <MeetingRow key={meeting.id} meeting={meeting} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="meet-empty">
          {search ? "No meetings match." : "No meetings yet."}
        </p>
      )}
    </Card>
  );
}

function ConnectionStatus({
  overview,
  connected,
}: {
  overview: Overview | null;
  connected: boolean;
}) {
  if (!overview) {
    return null;
  }

  if (overview.configured && overview.enabled && connected) {
    return (
      <span className="meet-connection" data-tone="success" role="status">
        Extension connected
      </span>
    );
  }

  let message = "Extension not connected";
  let tone = "muted";

  if (!overview.configured) {
    message = "Needs an OpenAI provider";
    tone = "warning";
  } else if (!overview.enabled) {
    message = "Disabled";
  }

  return (
    <span className="meet-connection" data-tone={tone} role="status">
      {message}
    </span>
  );
}

// Drive names Meet recordings "<event title> (<date> <zone>) - Recording".
// Instant meetings have no event, so Google uses the meeting code instead.
function recordingLabel(recording: {
  date?: string;
  name: string;
  size: number;
}) {
  const match =
    /^(.*?)\s*\((\d{4}-\d{2}-\d{2})[ T]?(\d{2}:\d{2})?[^)]*\)(?:\s*[-–]\s*Recording)?(?:\.\w+)?$/i.exec(
      recording.name
    );

  const base = match?.[1]?.trim() || recording.name;
  const code = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(base);

  const timestamp = Date.parse(
    recording.date || (match ? `${match[2]}T${match[3] ?? "00:00"}` : "")
  );

  const date = Number.isNaN(timestamp) ? null : new Date(timestamp);

  return {
    day: date ? String(date.getDate()) : "",
    details: [
      date?.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
      code ? base : null,
      `${Math.ceil(recording.size / 1024 / 1024)} MB`,
    ]
      .filter(Boolean)
      .join(" · "),
    month: date
      ? date.toLocaleDateString(undefined, { month: "short" }).toUpperCase()
      : "",
    title: code ? "Instant meeting" : base,
  };
}

function RecordingTile({
  recording,
}: {
  recording: MeetActionResults["recordings"]["recordings"][number];
}) {
  const label = recordingLabel(recording);

  return (
    <>
      <span aria-hidden="true" className="meet-date-tile">
        {label.month ? (
          <>
            <span>{label.month}</span>
            <strong>{label.day}</strong>
          </>
        ) : (
          <Video01Icon size={18} />
        )}
      </span>
      <span className="meet-meta">
        <strong>{label.title}</strong>
        <span className="meet-status">{label.details}</span>
      </span>
    </>
  );
}

const IMPORT_STEPS = [
  { label: "Download from Drive", step: "download" },
  { label: "Extract audio", step: "extract" },
  { label: "Transcribe with Whisper", step: "transcribe" },
  { label: "Save to meeting history", step: "save" },
] as const;

// A measured fraction when the server reports one, otherwise null for a
// sliding bar, so a long phase never looks frozen.
function stepProgress(progress: MeetImportProgress | null) {
  const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);

  if (progress?.step === "download" && progress.totalBytes && progress.bytes) {
    return {
      detail: `${megabytes(progress.bytes)} of ${megabytes(progress.totalBytes)} MB`,
      fraction: Math.min(progress.bytes / progress.totalBytes, 1),
    };
  }

  if (progress?.step === "transcribe" && progress.parts && progress.part) {
    return {
      detail:
        progress.parts > 1 ? `Part ${progress.part} of ${progress.parts}` : "",
      fraction:
        progress.parts > 1 ? (progress.part - 1) / progress.parts : null,
    };
  }

  return {
    detail:
      progress && progress.step !== "download" ? "" : "Preparing in Drive",
    fraction: null,
  };
}

function ImportSteps({ progress }: { progress: MeetImportProgress | null }) {
  const current = IMPORT_STEPS.findIndex(
    ({ step }) => step === (progress?.step ?? "download")
  );

  const active = stepProgress(progress);

  return (
    <ol aria-label="Import steps" className="meet-import-steps">
      {IMPORT_STEPS.map(({ label, step }, index) => {
        const state =
          index < current ? "done" : index === current ? "active" : "pending";

        return (
          <li data-state={state} key={step}>
            <span className="meet-import-step">
              <span aria-hidden="true" className="meet-step-mark">
                {state === "done" && <Tick02Icon size={14} />}
              </span>
              <span className={state === "active" ? "meet-shimmer" : undefined}>
                {label}
              </span>
              {state === "active" && active.detail && (
                <span className="meet-status">{active.detail}</span>
              )}
            </span>
            {state === "active" && (
              <span
                aria-label={label}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={
                  active.fraction === null
                    ? undefined
                    : Math.round(active.fraction * 100)
                }
                className="meet-step-progress"
                data-indeterminate={active.fraction === null || undefined}
                role="progressbar"
              >
                <span
                  style={
                    active.fraction === null
                      ? undefined
                      : { width: `${Math.max(active.fraction * 100, 2)}%` }
                  }
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function readUploadContent(file: File) {
  const markdown = /\.(md|markdown)$/i.test(file.name);

  if (!(markdown || /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(file.name))) {
    throw new Error("Choose a Markdown or supported audio file");
  }

  if (!file.size || file.size > (markdown ? 1 : 7) * 1024 * 1024) {
    throw new Error(`Choose a nonempty file under ${markdown ? 1 : 7} MB`);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function useExtensionBridge(
  call: MeetCall,
  signal: AbortSignal,
  setConnected: (connected: boolean) => void,
  setSelected: (meeting: Meeting) => void
) {
  React.useEffect(() => {
    async function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const eventData = event.data;

      if (!(eventData instanceof Object)) {
        return;
      }

      if ("type" in eventData && eventData.type === "NAKAMA_MEET_EXTENSION") {
        setConnected("connected" in eventData && eventData.connected === true);

        return;
      }

      if (
        !("type" in eventData) ||
        eventData.type !== "NAKAMA_MEET_ACTION" ||
        !("id" in eventData) ||
        !("action" in eventData)
      ) {
        return;
      }

      const actions: Array<
        | "meetings"
        | "start-capture"
        | "leave"
        | "transcript"
        | "show-transcript"
      > = [
        "meetings",
        "start-capture",
        "leave",
        "transcript",
        "show-transcript",
      ];

      const action = actions.find(
        (candidate) => candidate === String(eventData.action)
      );

      if (!action) {
        return;
      }

      const id = String(eventData.id);

      const incoming =
        "input" in eventData && eventData.input instanceof Object
          ? eventData.input
          : {};

      const input: MeetActionInput = {
        after: "after" in incoming ? Number(incoming.after) : undefined,
        content: "content" in incoming ? String(incoming.content) : undefined,
        enabled: "enabled" in incoming ? incoming.enabled === true : undefined,
        filename:
          "filename" in incoming ? String(incoming.filename) : undefined,
        meetingId:
          "meetingId" in incoming ? String(incoming.meetingId) : undefined,
      };

      try {
        let result: MeetActionResults[MeetAction];

        if (action === "show-transcript") {
          const transcript = await call("transcript", input);
          result = transcript;
          setSelected(transcript.meeting);
        } else {
          result = await call(action, input);
        }

        window.postMessage(
          { id, result, type: "NAKAMA_MEET_RESULT" },
          window.location.origin
        );
      } catch (reason) {
        if (signal.aborted) {
          return;
        }

        window.postMessage(
          { error: formatError(reason), id, type: "NAKAMA_MEET_RESULT" },
          window.location.origin
        );
      }
    }

    window.addEventListener("message", receive);

    const ping = () =>
      window.postMessage({ type: "NAKAMA_MEET_PING" }, window.location.origin);

    ping();
    const timer = setInterval(ping, 3000);

    return () => {
      window.removeEventListener("message", receive);
      clearInterval(timer);
    };
  }, [call, signal, setConnected, setSelected]);
}

function RecordingPicker({ close, call }: { close(): void; call: MeetCall }) {
  type Recording = MeetActionResults["recordings"]["recordings"][number];

  const [result, setResult] = React.useState<
    MeetActionResults["recordings"] | null
  >(null);

  const [error, setError] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const [progress, setProgress] = React.useState<MeetImportProgress | null>(
    null
  );

  const importAbort = React.useRef<AbortController | null>(null);

  const [selected, setSelected] = React.useState("");
  const [connecting, setConnecting] = React.useState("");
  const { user } = useAuth();
  React.useEffect(() => {
    let mounted = true;
    call("recordings").then(
      (value) => {
        if (mounted) {
          // SAFETY: The surrounding code checked this value before the assertion.
          setResult(value as NonNullable<typeof result>);
        }
      },
      (reason) => {
        if (mounted) {
          setError(formatError(reason));
        }
      }
    );

    return () => {
      mounted = false;
    };
  }, [call]);

  React.useEffect(() => {
    if (!importing) {
      return;
    }

    const timer = setInterval(() => {
      call("import-progress").then(
        (value) => setProgress(value.progress),
        () => undefined
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [call, importing]);

  React.useEffect(() => () => importAbort.current?.abort(), []);

  async function importRecording(recording: Recording) {
    const abort = new AbortController();
    importAbort.current = abort;
    setImporting(true);
    setProgress(null);
    setError("");

    try {
      await call(
        "import-recording",
        { fileId: recording.fileId, messageId: recording.messageId },
        abort.signal
      );
      close();
    } catch (reason) {
      if (!abort.signal.aborted) {
        setError(formatError(reason));
      }
    } finally {
      importAbort.current = null;
      setImporting(false);
    }
  }

  async function connect(toolkitSlug: string) {
    setConnecting(toolkitSlug);
    setError("");

    try {
      const { redirectUrl } =
        await client.connectMeetRecordingSource(toolkitSlug);

      if (!isAllowedComposioRedirectUrl(redirectUrl)) {
        throw new Error("Blocked an unexpected Composio redirect URL.");
      }

      window.location.href = redirectUrl;
    } catch (reason) {
      setError(formatError(reason));
      setConnecting("");
    }
  }

  const recordings = result?.recordings ?? [];

  const recordingKey = (recording: Recording) =>
    `${recording.messageId}:${recording.fileId}`;

  const picked =
    recordings.find((recording) => recordingKey(recording) === selected) ??
    recordings[0];

  const connections = result && [
    {
      connected: result.gmailConnected,
      logo: "gmail",
      name: "Gmail",
      slug: "gmail",
    },
    {
      connected: result.driveConnected,
      logo: "google-drive",
      name: "Google Drive",
      slug: "googledrive",
    },
  ];

  const ready = result?.gmailConnected && result.driveConnected;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || importing)) {
          close();
        }
      }}
      open
    >
      <DialogContent className="sm:max-w-xl">
        {!(result || error) && (
          <span aria-hidden="true" className="meet-loading-bar" />
        )}
        <DialogHeader>
          <DialogTitle>
            {importing ? "Importing recording" : "Import recording"}
          </DialogTitle>
          {!(result || error) && (
            <p className="meet-status meet-shimmer" role="status">
              Finding recordings…
            </p>
          )}
        </DialogHeader>
        {error && <p role="alert">{error}</p>}
        {!(result || error) && (
          <div aria-hidden="true" className="meet-recordings-placeholder">
            {["48%", "40%", "54%"].map((width) => (
              <span key={width}>
                <span className="meet-date-tile" />
                <span>
                  <span style={{ width }} />
                  <span style={{ width: "30%" }} />
                </span>
              </span>
            ))}
          </div>
        )}
        {result && !result.composioConfigured && (
          <p>
            {user?.isPlatformAdmin ? (
              <>
                Set up Composio in{" "}
                <a href="/integrations?section=composio">Integrations</a> to
                import recordings.
              </>
            ) : (
              "Ask your platform admin to set up Composio to import recordings."
            )}
          </p>
        )}
        {result?.composioConfigured && connections && !ready && (
          <ul className="meet-connections">
            {connections.map(({ connected, logo, name, slug }) => (
              <li key={name}>
                <span className="meet-tile-icon">
                  <img
                    alt=""
                    height={20}
                    src={`/icons/${logo}.svg`}
                    width={20}
                  />
                </span>
                <span className="meet-meta">
                  <strong>{name}</strong>
                  <span
                    className="meet-connection"
                    data-tone={connected ? "success" : "muted"}
                  >
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </span>
                {!connected && (
                  <Button
                    disabled={!!connecting}
                    onClick={() => void connect(slug)}
                    size="sm"
                    type="button"
                  >
                    {connecting === slug ? "Connecting…" : "Connect"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {importing && picked && (
          <div className="meet-import">
            <div className="meet-import-recording">
              <RecordingTile recording={picked} />
            </div>
            <ImportSteps progress={progress} />
          </div>
        )}
        {ready &&
          !importing &&
          (recordings.length ? (
            <fieldset className="meet-recordings">
              <legend className="sr-only">Recording</legend>
              {recordings.map((recording) => (
                <label key={recordingKey(recording)}>
                  <input
                    checked={recording === picked}
                    name="recording"
                    onChange={() => setSelected(recordingKey(recording))}
                    type="radio"
                  />
                  <RecordingTile recording={recording} />
                  <span aria-hidden="true" className="meet-check">
                    <Tick02Icon size={14} />
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p>No Meet recording emails found.</p>
          ))}
        <DialogFooter className="meet-import-footer">
          {importing && (
            <p className="meet-status" role="status">
              Keep this page open.
            </p>
          )}
          <Button
            onClick={() => (importing ? importAbort.current?.abort() : close())}
            type="button"
            variant="outline"
          >
            {importing ? "Cancel import" : "Cancel"}
          </Button>
          {ready && recordings.length > 0 && !importing && (
            <Button
              disabled={!picked}
              onClick={() => picked && void importRecording(picked)}
              type="button"
            >
              Import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MeetPage({ call, signal }: { call: MeetCall; signal: AbortSignal }) {
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const [extensionConnected, setExtensionConnected] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [settings, setSettings] = React.useState<boolean | null>(null);
  const [deleting, setDeleting] = React.useState<Meeting | null>(null);
  const [selected, setSelected] = React.useState<Meeting | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Composio OAuth returns here with ?import=recording to resume the import.
  const [recordingPicker, setRecordingPicker] = React.useState(
    () => searchParams.get("import") === "recording"
  );

  React.useEffect(() => {
    if (searchParams.has("import")) {
      setSearchParams(
        (params) => {
          params.delete("import");

          return params;
        },
        { replace: true }
      );
    }
  }, [searchParams, setSearchParams]);
  const uploadInput = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError("");

    try {
      const content = await readUploadContent(file);

      await call("upload", { content, filename: file.name });
      setOverview(await call("meetings"));
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setUploading(false);
    }
  }

  useExtensionBridge(call, signal, setExtensionConnected, setSelected);

  React.useEffect(() => {
    let alive = true;
    let running = false;

    function refresh() {
      if (!alive || running || signal.aborted) {
        return;
      }

      running = true;
      void call("meetings")
        .then((result) => {
          if (alive && !signal.aborted) {
            setOverview(result);
          }
        })
        .catch((reason) => {
          if (alive && !signal.aborted) {
            setError(formatError(reason));
          }
        })
        .finally(() => {
          running = false;
        });
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 3000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [call, signal]);

  async function action(name: MeetAction, input: MeetActionInput) {
    setBusy(true);
    setError("");

    try {
      await call(name, input);
      setOverview(await call("meetings"));
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  const meetings = overview?.meetings ?? [];
  const live = meetings.filter(isActive);

  const deleteDialog = deleting && (
    <ConfirmDialog
      confirmLabel="Delete meeting"
      description={`This permanently deletes the meeting from ${new Date(deleting.createdAt).toLocaleString()} and its transcript. You can’t undo this.`}
      onClose={() => setDeleting(null)}
      onConfirm={async () => {
        await call("delete", { meetingId: deleting.id });
        setSelected(null);
        setOverview((previous) =>
          previous
            ? {
                ...previous,
                meetings: previous.meetings.filter(
                  (meeting) => meeting.id !== deleting.id
                ),
              }
            : previous
        );
      }}
      title="Delete meeting?"
    />
  );

  if (selected) {
    return (
      <section className="meet-page">
        <Transcript
          call={call}
          close={() => setSelected(null)}
          key={selected.id}
          meeting={
            meetings.find((meeting) => meeting.id === selected.id) ?? selected
          }
          onDelete={setDeleting}
          signal={signal}
        />
        {deleteDialog}
      </section>
    );
  }

  return (
    <section className="meet-page">
      <header className="meet-header">
        <div className="meet-row">
          <h1>Google Meet</h1>
          <ConnectionStatus
            connected={extensionConnected}
            overview={overview}
          />
        </div>
        <div className="meet-row">
          <input
            accept=".md,.markdown,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm"
            aria-label="Upload audio or Markdown"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";

              if (file) {
                void upload(file);
              }
            }}
            ref={uploadInput}
            type="file"
          />
          <Button
            disabled={uploading}
            onClick={() => uploadInput.current?.click()}
            title="Audio up to 7 MB or Markdown up to 1 MB"
            variant="outline"
          >
            <Upload01Icon aria-hidden="true" size={16} />
            {uploading ? "Importing…" : "Upload file"}
          </Button>
          <Button
            disabled={!(overview?.enabled && overview.configured)}
            onClick={() => setRecordingPicker(true)}
          >
            <Video01Icon aria-hidden="true" size={16} />
            Import recording
          </Button>
          {overview?.canConfigure && (
            <Button
              aria-label="Settings"
              onClick={() => setSettings(true)}
              size="icon"
              title="Settings"
              variant="outline"
            >
              <Settings01Icon aria-hidden="true" size={16} />
            </Button>
          )}
        </div>
      </header>
      {overview && !extensionConnected && (
        <section aria-label="Live capture setup" className="meet-setup">
          <span aria-hidden="true" className="meet-setup-icon">
            <Mic01Icon size={18} />
          </span>
          <div className="meet-setup-copy">
            <strong>Record live calls</strong>
            <span>
              Install the Chrome extension, then choose Connect this Nakama tab.
            </span>
          </div>
          <a
            className={buttonVariants({ variant: "outline" })}
            download
            href="/google-meet-extension.zip"
          >
            <Download01Icon aria-hidden="true" size={16} />
            Download extension
          </a>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {live.map((meeting) => (
        <LiveMeeting
          busy={busy}
          call={call}
          key={meeting.id}
          meeting={meeting}
          onOpen={setSelected}
          onStop={(meetingId) => void action("leave", { meetingId })}
          signal={signal}
        />
      ))}
      {overview ? (
        <MeetingHistory meetings={meetings} onOpen={setSelected} />
      ) : (
        <p>Loading…</p>
      )}
      {deleteDialog}
      {recordingPicker && (
        <RecordingPicker call={call} close={() => setRecordingPicker(false)} />
      )}
      {(settings ?? (overview?.canConfigure && !overview.configured)) && (
        <Settings
          call={call}
          close={() => setSettings(false)}
          configured={overview?.configured === true}
          enabled={overview?.enabled !== false}
        />
      )}
    </section>
  );
}

export function GoogleMeetPage() {
  const { activeOrg } = useAuth();

  if (!activeOrg) {
    return <p role="alert">Member access required</p>;
  }

  return <OrganizationMeetPage key={activeOrg.id} orgId={activeOrg.id} />;
}

function OrganizationMeetPage({ orgId }: { orgId: string }) {
  const [scope, setScope] = React.useState<{
    call: MeetCall;
    signal: AbortSignal;
  } | null>(null);

  React.useEffect(() => {
    const abort = new AbortController();
    setScope({
      call: async <Action extends MeetAction>(
        action: Action,
        input?: MeetActionInput,
        signal?: AbortSignal
      ): Promise<MeetActionResults[Action]> => {
        abort.signal.throwIfAborted();

        const result = await client.invokeGoogleMeet(
          action,
          input,
          orgId,
          signal ? AbortSignal.any([abort.signal, signal]) : abort.signal
        );

        abort.signal.throwIfAborted();

        return result;
      },
      signal: abort.signal,
    });

    return () => abort.abort();
  }, [orgId]);

  return scope ? <MeetPage {...scope} /> : null;
}
