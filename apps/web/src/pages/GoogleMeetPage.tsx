import {
  formatTranscript,
  type MeetAction,
  type MeetActionInput,
  type MeetActionResults,
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
  Input,
  Switch,
} from "@nakama/ui";
import {
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
} from "hugeicons-react";
import * as React from "react";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

type MeetCall = <Action extends MeetAction>(
  action: Action,
  input?: MeetActionInput
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
  const [apiKey, setApiKey] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await call("configure", {
        apiKey: apiKey.trim() || undefined,
        enabled,
      });
      setApiKey("");
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
          <div className="meet-row" style={{ justifyContent: "space-between" }}>
            <label htmlFor="meet-api-key">OpenAI API key</label>
            <a
              href="https://platform.openai.com/api-keys"
              rel="noreferrer"
              style={{
                fontSize: 14,
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
              target="_blank"
            >
              Get an API key ↗
            </a>
          </div>
          <Input
            aria-describedby="meet-api-key-note"
            autoComplete="off"
            disabled={busy}
            id="meet-api-key"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured
                ? "Paste a new key to replace it"
                : "Paste your key here"
            }
            type="password"
            value={apiKey}
          />
          {configured && <p className="meet-status">A key is already saved.</p>}
          <p className="meet-status" id="meet-api-key-note">
            OpenAI charges for transcription separately from ChatGPT.
          </p>
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
              {busy
                ? "Saving…"
                : enabled
                  ? "Enable transcription"
                  : "Save changes"}
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
}: {
  meeting: Meeting;
  close(): void;
  call: MeetCall;
  signal: AbortSignal;
}) {
  const [segments, setSegments] = React.useState<TranscriptSegment[]>([]);
  const text = formatTranscript(segments, Boolean(meeting.sourceName));
  const [error, setError] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState("");
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => heading.current?.focus(), []);
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
        meetingId: meeting.id,
      })
        .then((result) => {
          const value = result;

          if (alive && !signal.aborted) {
            cursor = value.nextCursor;
            setSegments((previous) => {
              const seen = new Set(previous.map((segment) => segment.id));

              return [
                ...previous,
                ...value.segments.filter((segment) => !seen.has(segment.id)),
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
  }, [meeting.id, call, signal]);

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
              ? ["queued", "joining", "recording", "transcribing"].includes(
                  meeting.state
                )
                ? "Waiting for speech…"
                : "No speech was captured."
              : "Loading transcript…"}
          </p>
        </Card>
      )}
    </section>
  );
}

function MeetingRow({
  meeting,
  busy,
  onStop,
  onDelete,
  onOpen,
}: {
  meeting: Meeting;
  busy: boolean;
  onStop(meetingId: string): void;
  onDelete(meeting: Meeting): void;
  onOpen(meeting: Meeting): void;
}) {
  return (
    <li>
      <div className="meet-meeting">
        <div className="meet-meta">
          <h3>{meeting.title || meeting.sourceName || "Untitled meeting"}</h3>
          <span className="meet-status">
            {new Date(meeting.createdAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {" · "}
            {new Date(meeting.createdAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="meet-row">
          {meetingStatus(meeting) !== "Transcript ready" && (
            <span className="meet-badge">{meetingStatus(meeting)}</span>
          )}
          {["queued", "joining", "recording", "transcribing"].includes(
            meeting.state
          ) && (
            <Button
              className="meet-action"
              disabled={
                busy ||
                !!meeting.stopRequested ||
                meeting.state === "transcribing"
              }
              onClick={() => onStop(meeting.id)}
              size="sm"
              variant="outline"
            >
              Stop transcription
            </Button>
          )}
          {["finished", "failed"].includes(meeting.state) && (
            <Button
              aria-label="Delete meeting"
              className="meet-action meet-delete"
              disabled={busy}
              onClick={() => {
                onDelete(meeting);
              }}
              size="icon"
              title="Delete meeting"
              variant="ghost"
            >
              <Delete02Icon aria-hidden="true" size={16} />
            </Button>
          )}
          <Button
            aria-label={
              meeting.transcriptFile ? "Read transcript" : "View details"
            }
            className="meet-open"
            onClick={() => onOpen(meeting)}
            size="icon"
            title={meeting.transcriptFile ? "Read transcript" : "View details"}
            variant="ghost"
          >
            <ArrowRight01Icon aria-hidden="true" size={16} />
          </Button>
        </div>
      </div>
      {meeting.error && <p role="alert">{meeting.error}</p>}
    </li>
  );
}

function ConnectionStatus({
  overview,
  connected,
}: {
  overview: Overview | null;
  connected: boolean;
}) {
  let connectionMessage =
    "Connected. Start transcription from the extension in your Google Meet tab. Keep this page open.";

  if (!overview) {
    connectionMessage = "Checking connection…";
  } else if (!overview.configured) {
    connectionMessage = "Set a transcription API key in Settings.";
  } else if (!overview.enabled) {
    connectionMessage = "Google Meet is disabled.";
  } else if (!connected) {
    connectionMessage =
      "Open the Chrome extension on this page and choose Connect this Nakama tab.";
  }

  return (
    <span className="meet-status" role="status">
      {connectionMessage}
    </span>
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
        apiKey: "apiKey" in incoming ? String(incoming.apiKey) : undefined,
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

function MeetPage({ call, signal }: { call: MeetCall; signal: AbortSignal }) {
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const [extensionConnected, setExtensionConnected] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [settings, setSettings] = React.useState<boolean | null>(null);
  const [deleting, setDeleting] = React.useState<Meeting | null>(null);
  const [selected, setSelected] = React.useState<Meeting | null>(null);
  const [uploading, setUploading] = React.useState(false);
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

  const groups = [
    {
      meetings: meetings.filter((meeting) =>
        ["queued", "joining", "recording", "transcribing"].includes(
          meeting.state
        )
      ),
      title: "In progress",
    },
    {
      meetings: meetings.filter((meeting) =>
        ["finished", "failed"].includes(meeting.state)
      ),
      title: "Meeting history",
    },
  ];

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
          signal={signal}
        />
      </section>
    );
  }

  return (
    <section className="meet-page">
      <a download href="/google-meet-extension.zip">
        Download Chrome extension
      </a>
      {error && <p role="alert">{error}</p>}
      <Card className="meet-card">
        <div className="meet-card-heading">
          <h2>Google Meet</h2>
          {overview?.canConfigure && (
            <Button
              onClick={() => setSettings(true)}
              size="sm"
              variant="outline"
            >
              Settings
            </Button>
          )}
        </div>
        <div
          className="meet-card-heading"
          style={{ borderBottom: 0, borderTop: "1px solid var(--border)" }}
        >
          <ConnectionStatus
            connected={extensionConnected}
            overview={overview}
          />
        </div>
      </Card>
      {overview ? (
        groups.flatMap((group) => {
          if (group.title === "In progress" && !group.meetings.length) {
            return [];
          }

          return [
            <section key={group.title}>
              <Card className="meet-card">
                <div className="meet-card-heading">
                  <h2>{group.title}</h2>
                  <div className="meet-row">
                    <span className="meet-status">{group.meetings.length}</span>
                    {group.title === "Meeting history" && (
                      <>
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
                          size="sm"
                          title="Audio up to 7 MB or Markdown up to 1 MB"
                          variant="outline"
                        >
                          {uploading ? "Importing…" : "Upload file"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {group.meetings.length ? (
                  <ul className="meet-list">
                    {group.meetings.map((meeting) => (
                      <MeetingRow
                        busy={busy}
                        key={meeting.id}
                        meeting={meeting}
                        onDelete={setDeleting}
                        onOpen={setSelected}
                        onStop={(meetingId) =>
                          void action("leave", { meetingId })
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="meet-empty">No meetings yet.</p>
                )}
              </Card>
            </section>,
          ];
        })
      ) : (
        <p>Loading…</p>
      )}
      {deleting && (
        <ConfirmDialog
          confirmLabel="Delete meeting"
          description={`This permanently deletes the meeting from ${new Date(deleting.createdAt).toLocaleString()} and its transcript. You can’t undo this.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await call("delete", { meetingId: deleting.id });
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

  if (!activeOrg || activeOrg.role === "viewer") {
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
        input?: MeetActionInput
      ): Promise<MeetActionResults[Action]> => {
        abort.signal.throwIfAborted();

        const result = await client.invokeGoogleMeet(
          action,
          input,
          orgId,
          abort.signal
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
