/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as UI from "@nakama/ui";
import type * as ReactType from "react";
import type { Meeting } from "./store";
import type { TranscriptSegment } from "./transcription";

type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  signal: AbortSignal;
  slots: { register(slot: "page", component: ReactType.ComponentType): void };
  styles(css: string): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
};
type Overview = {
  meetings: Meeting[];
  configured: boolean;
  canConfigure: boolean;
  worker: { state: string; message?: string; captureUrl?: string };
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";
export const inject = ["slots", "host", "styles", "ui"];

export function apply(ctx: Context) {
  const React = ctx.React;
  const {
    Button,
    Card,
    CodeBlock,
    Input,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } = ctx.ui;
  ctx.styles(
    `
    .meet-page{display:grid;gap:32px;max-width:768px;width:100%;min-width:0;margin:0 auto;font-size:14px}
    .meet-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .meet-card{box-shadow:none;overflow:hidden}
    .meet-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .meet-page h2,.meet-page h3{font-size:14px;font-weight:500;margin:0}
    .meet-form{display:grid;gap:12px}
    .meet-form label{display:grid;gap:6px;font-size:14px;font-weight:500;min-width:0}
    .meet-join{padding:16px;grid-template-columns:minmax(0,1fr) 100px;align-items:end}
    .meet-join-footer{grid-column:1/-1;display:flex;justify-content:flex-end;padding-top:4px}
    .meet-list{list-style:none;padding:0;margin:0}
    .meet-list li{padding:16px;display:grid;gap:10px}
    .meet-list li+li{border-top:1px solid var(--border)}
    .meet-meeting{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    .meet-meta{display:grid;gap:4px;min-width:0;flex:1 1 220px}
    .meet-link{font-weight:500;overflow-wrap:anywhere}
    .meet-link:hover{text-decoration:underline}
    .meet-status{font-size:12px;color:var(--muted-foreground);overflow-wrap:anywhere}
    .meet-badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--muted-foreground)}
    .meet-empty{padding:32px 16px;text-align:center;color:var(--muted-foreground);font-size:14px}
    .meet-page [role=alert]{font-size:14px;color:var(--destructive);overflow-wrap:anywhere}
    .meet-detail{display:grid;gap:16px;min-width:0}
    .meet-detail-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .meet-code{border:1px solid var(--border);border-radius:8px;min-width:0}
    @media(max-width:480px){.meet-join{grid-template-columns:minmax(0,1fr)}.meet-join-footer>button{width:100%}}
    `
  );

  function Settings({ close }: { close(): void }) {
    const [apiKey, setApiKey] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    async function save(event: ReactType.FormEvent) {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        await ctx.host.call("configure", {
          apiKey: apiKey || undefined,
        });
        setApiKey("");
        close();
      } catch (reason) {
        setError(message(reason));
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
            <DialogTitle>Google Meet settings</DialogTitle>
          </DialogHeader>
          <form className="meet-form" onSubmit={save}>
            <label>
              OpenAI API key
              <Input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Keep saved key"
                type="password"
                value={apiKey}
              />
            </label>
            <p className="meet-status">
              gpt-transcribe uses separate API billing. Your ChatGPT
              subscription does not cover transcription.
            </p>
            <p className="meet-status">
              Install the Nakama Chrome extension. After joining, paste the
              capture URL into its popup and start capture.
            </p>
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  function Transcript({ meeting, close }: { meeting: Meeting; close(): void }) {
    const [text, setText] = React.useState("");
    const [error, setError] = React.useState("");
    const [loaded, setLoaded] = React.useState(false);
    const heading = React.useRef<HTMLHeadingElement>(null);
    React.useEffect(() => heading.current?.focus(), []);
    React.useEffect(() => {
      let alive = true;
      let cursor = 0;
      let running = false;
      async function refresh() {
        if (!alive || running || ctx.signal.aborted) {
          return;
        }
        running = true;
        try {
          const value = (await ctx.host.call("transcript", {
            after: cursor,
            meetingId: meeting.id,
          })) as {
            segments: (TranscriptSegment & { sequence: number })[];
            nextCursor: number;
          };
          if (alive && !ctx.signal.aborted) {
            cursor = value.nextCursor;
            setText(
              (previous) =>
                previous +
                value.segments.map((segment) => segment.text + "\n").join("")
            );
            setError("");
            setLoaded(true);
          }
        } catch (reason) {
          if (alive) {
            setError(message(reason));
          }
        } finally {
          running = false;
        }
      }
      void refresh();
      const timer = setInterval(() => void refresh(), 2000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [meeting.id]);
    function download() {
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `meeting-${meeting.id}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return (
      <section className="meet-detail">
        <div>
          <Button onClick={close} size="sm" variant="ghost">
            ← Back to meetings
          </Button>
        </div>
        <div className="meet-detail-heading">
          <div className="meet-meta">
            <h2 ref={heading} tabIndex={-1}>
              Meeting transcript
            </h2>
            <a
              className="meet-link"
              href={meeting.url}
              rel="noreferrer"
              target="_blank"
            >
              {meeting.url.replace("https://", "")}
            </a>
            <span className="meet-status">
              {new Date(meeting.createdAt).toLocaleString()} · {meeting.state}
            </span>
          </div>
          <Button
            disabled={!text}
            onClick={download}
            size="sm"
            variant="outline"
          >
            Download transcript
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        {text ? (
          <CodeBlock
            className="meet-code"
            code={text}
            lang={meeting.transcriptFile || "text"}
          />
        ) : (
          <Card className="meet-card">
            <p className="meet-empty" role="status">
              {loaded
                ? ["queued", "joining", "transcribing"].includes(meeting.state)
                  ? "Waiting for speech…"
                  : "No speech was captured."
                : "Loading transcript…"}
            </p>
          </Card>
        )}
      </section>
    );
  }

  function Page() {
    const [overview, setOverview] = React.useState<Overview | null>(null);
    const [error, setError] = React.useState("");
    const [url, setUrl] = React.useState("");
    const [duration, setDuration] = React.useState(120);
    const [captureUrl, setCaptureUrl] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [settings, setSettings] = React.useState(false);
    const [selected, setSelected] = React.useState<Meeting | null>(null);
    React.useEffect(() => {
      let alive = true;
      let running = false;
      async function refresh() {
        if (!alive || running || ctx.signal.aborted) {
          return;
        }
        running = true;
        try {
          const result = (await ctx.host.call("meetings")) as Overview;
          if (alive && !ctx.signal.aborted) {
            setOverview(result);
          }
        } catch (reason) {
          if (alive) {
            setError(message(reason));
          }
        } finally {
          running = false;
        }
      }
      void refresh();
      const timer = setInterval(() => void refresh(), 3000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);
    async function action(name: string, input: unknown) {
      setBusy(true);
      setError("");
      try {
        const result = await ctx.host.call(name, input);
        if (name === "start-capture") {
          const capture = (result as { capture?: { url?: string } }).capture;
          setCaptureUrl(capture?.url ?? "");
          if (capture?.url) {
            window.postMessage(
              {
                captureUrl: capture.url,
                meetingUrl: (input as { url?: string }).url,
                type: "START_CAPTURE",
              },
              window.location.origin
            );
          }
        }
        setOverview((await ctx.host.call("meetings")) as Overview);
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    }
    const active = overview?.meetings.some((meeting) =>
      ["queued", "joining", "transcribing"].includes(meeting.state)
    );
    const groups = [
      {
        meetings:
          overview?.meetings.filter((meeting) => !meeting.transcriptFile) ?? [],
        title: "Meetings",
      },
      {
        meetings:
          overview?.meetings.filter((meeting) => meeting.transcriptFile) ?? [],
        title: "Saved transcripts",
      },
    ];
    if (selected) {
      return (
        <section className="meet-page">
          <Transcript
            close={() => setSelected(null)}
            key={selected.id}
            meeting={
              overview?.meetings.find(
                (meeting) => meeting.id === selected.id
              ) ?? selected
            }
          />
        </section>
      );
    }
    return (
      <section className="meet-page">
        {error && <p role="alert">{error}</p>}
        <Card className="meet-card">
          <div className="meet-card-heading">
            <h2>Join a meeting</h2>
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
          <form
            className="meet-form meet-join"
            onSubmit={(event) => {
              event.preventDefault();
              void action("start-capture", { durationMinutes: duration, url });
            }}
          >
            <label>
              Meeting link
              <Input
                aria-label="Google Meet URL"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
                required
                type="url"
                value={url}
              />
            </label>
            <label>
              Minutes
              <Input
                aria-label="Maximum meeting minutes"
                max={120}
                min={1}
                onChange={(event) => setDuration(Number(event.target.value))}
                required
                type="number"
                value={duration}
              />
            </label>
            <div className="meet-join-footer">
              <Button
                disabled={
                  busy ||
                  active ||
                  !overview?.configured ||
                  overview.worker.state !== "ready"
                }
                type="submit"
              >
                Start capture session
              </Button>
            </div>
          </form>
          <div
            className="meet-card-heading"
            style={{ borderBottom: 0, borderTop: "1px solid var(--border)" }}
          >
            <span className="meet-status" role="status">
              {overview
                ? overview.configured
                  ? overview.worker.state === "ready"
                    ? "Ready. Join, then start the Chrome extension."
                    : "Start Google Meet in Workers."
                  : "Set a transcription API key in Settings."
                : "Checking connection…"}
            </span>
          </div>
        </Card>
        {captureUrl && (
          <Card className="meet-card">
            <div className="meet-card-heading">
              <h2>Capture session</h2>
            </div>
            <div style={{ padding: 16 }}>
              <p className="meet-status">
                The extension was notified. Keep the Google Meet tab open while
                capture runs. If it did not start, paste this URL into the
                extension popup.
              </p>
              <CodeBlock className="meet-code">{captureUrl}</CodeBlock>
            </div>
          </Card>
        )}
        {overview ? (
          groups.map((group) => (
            <section key={group.title}>
              <Card className="meet-card">
                <div className="meet-card-heading">
                  <h2>{group.title}</h2>
                  <span className="meet-status">{group.meetings.length}</span>
                </div>
                {group.meetings.length ? (
                  <ul className="meet-list">
                    {group.meetings.map((meeting) => (
                      <li key={meeting.id}>
                        <div className="meet-meeting">
                          <div className="meet-meta">
                            <a
                              className="meet-link"
                              href={meeting.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {meeting.url.replace("https://", "")}
                            </a>
                            <time
                              className="meet-status"
                              dateTime={new Date(
                                meeting.createdAt
                              ).toISOString()}
                            >
                              {new Date(meeting.createdAt).toLocaleString()}
                            </time>
                          </div>
                          <div className="meet-row">
                            <span className="meet-badge">
                              {meeting.state}
                              {meeting.stopRequested &&
                              ["queued", "joining", "transcribing"].includes(
                                meeting.state
                              )
                                ? " · stopping"
                                : ""}
                            </span>
                            <Button
                              onClick={() => setSelected(meeting)}
                              size="sm"
                              variant="outline"
                            >
                              {meeting.transcriptFile
                                ? "Open transcript"
                                : "Transcript"}
                            </Button>
                            {["queued", "joining", "transcribing"].includes(
                              meeting.state
                            ) && (
                              <Button
                                disabled={busy || !!meeting.stopRequested}
                                onClick={() =>
                                  void action("leave", {
                                    meetingId: meeting.id,
                                  })
                                }
                                size="sm"
                                variant="outline"
                              >
                                Leave
                              </Button>
                            )}
                          </div>
                        </div>
                        {meeting.error && <p role="alert">{meeting.error}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="meet-empty">
                    {group.title === "Meetings"
                      ? "No meetings yet."
                      : "No saved transcripts yet."}
                  </p>
                )}
              </Card>
            </section>
          ))
        ) : (
          <p>Loading…</p>
        )}
        {settings && <Settings close={() => setSettings(false)} />}
      </section>
    );
  }
  ctx.slots.register("page", Page);
}
