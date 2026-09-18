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

export function meetingGroups(meetings: Meeting[], now = new Date()) {
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, Meeting[]>([["In progress", []]]);
  for (const meeting of meetings) {
    const date = new Date(meeting.createdAt);
    const title = ["queued", "joining", "transcribing"].includes(meeting.state)
      ? "In progress"
      : date.toDateString() === today
        ? "Today"
        : date.toDateString() === yesterday.toDateString()
          ? "Yesterday"
          : date.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            });
    const group = groups.get(title) ?? [];
    group.push(meeting);
    groups.set(title, group);
  }
  return [...groups]
    .filter(([, items]) => items.length)
    .map(([title, items]) => ({ meetings: items, title }));
}

export function apply(ctx: Context) {
  const React = ctx.React;
  const { Button, Card, CodeBlock, ConfirmDialog, Delete02Icon } = ctx.ui;
  ctx.styles(
    `
    .meet-page{display:grid;gap:32px;max-width:768px;width:100%;min-width:0;margin:0 auto;font-size:14px}
    .meet-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .meet-card{box-shadow:none;overflow:hidden}
    .meet-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)}
    .meet-page h2,.meet-page h3{font-size:14px;font-weight:500;margin:0}
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
    `
  );

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
    const [extensionConnected, setExtensionConnected] = React.useState<
      boolean | null
    >(null);
    const [busy, setBusy] = React.useState(false);
    const [deleting, setDeleting] = React.useState<Meeting | null>(null);
    const [selected, setSelected] = React.useState<Meeting | null>(null);
    React.useEffect(() => {
      async function receive(event: MessageEvent) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin
        ) {
          return;
        }
        const data = event.data;
        if (data?.type === "NAKAMA_MEET_EXTENSION") {
          setExtensionConnected(data.connected === true);
          return;
        }
        if (
          data?.type !== "NAKAMA_MEET_ACTION" ||
          typeof data.id !== "string" ||
          !["meetings", "start-capture", "leave"].includes(data.action)
        ) {
          return;
        }
        try {
          const result = await ctx.host.call(data.action, data.input);
          window.postMessage(
            { id: data.id, result, type: "NAKAMA_MEET_RESULT" },
            window.location.origin
          );
        } catch (reason) {
          window.postMessage(
            { error: message(reason), id: data.id, type: "NAKAMA_MEET_RESULT" },
            window.location.origin
          );
        }
      }
      window.addEventListener("message", receive);
      const ping = () =>
        window.postMessage(
          { type: "NAKAMA_MEET_PING" },
          window.location.origin
        );
      ping();
      const detectionTimeout = setTimeout(
        () => setExtensionConnected((connected) => connected ?? false),
        1500
      );
      const timer = setInterval(ping, 3000);
      return () => {
        window.removeEventListener("message", receive);
        clearInterval(timer);
        clearTimeout(detectionTimeout);
      };
    }, []);
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
        await ctx.host.call(name, input);
        setOverview((await ctx.host.call("meetings")) as Overview);
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    }
    const groups = meetingGroups(overview?.meetings ?? []);
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
        {deleting && (
          <ConfirmDialog
            description="This meeting and its transcript will be deleted. You can’t get them back."
            onClose={() => setDeleting(null)}
            onConfirm={async () => {
              await ctx.host.call("delete", { meetingId: deleting.id });
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
        {error && <p role="alert">{error}</p>}
        <Card className="meet-card">
          <div className="meet-card-heading">
            <h2>Transcription</h2>
            {overview?.canConfigure && (
              <Button
                render={<a href="/customize/providers" />}
                size="sm"
                variant="outline"
              >
                {overview.configured
                  ? "Manage OpenAI connection"
                  : "Set up OpenAI"}
              </Button>
            )}
          </div>
          <div
            className="meet-card-heading"
            style={{ borderBottom: 0, borderTop: "1px solid var(--border)" }}
          >
            <span className="meet-status" role="status">
              {overview
                ? overview.configured
                  ? overview.worker.state === "ready"
                    ? extensionConnected === null
                      ? "Checking extension connection…"
                      : extensionConnected
                        ? "Connected. Start transcription from your Google Meet tab."
                        : "Open the Chrome extension on this page and choose Connect."
                    : "Start Google Meet in Workers."
                  : "Connect OpenAI in AI Providers, then reinstall Google Meet to use the saved connection."
                : "Checking connection…"}
            </span>
          </div>
        </Card>
        {extensionConnected === false && (
          <Card className="meet-card" style={{ padding: 16 }}>
            <Button
              render={
                <a
                  download="nakama-google-meet-extension.zip"
                  href="/v1/plugins/official/google-meet/extension.zip"
                />
              }
              variant="outline"
            >
              Download Chrome extension
            </Button>
            <ol
              style={{
                listStyleType: "decimal",
                marginTop: 12,
                paddingLeft: 20,
              }}
            >
              <li>Unzip the download.</li>
              <li>
                Open <code>chrome://extensions</code> and enable Developer mode.
              </li>
              <li>
                Choose <strong>Load unpacked</strong> and select the unzipped
                folder.
              </li>
              <li>
                Refresh this page, open the extension, and choose{" "}
                <strong>Connect this Nakama tab</strong>.
              </li>
            </ol>
          </Card>
        )}
        {overview ? (
          <Card className="meet-card">
            <div className="meet-card-heading">
              <h2>Meeting history</h2>
              <span className="meet-status">{overview.meetings.length}</span>
            </div>
            {!groups.length && (
              <p className="meet-empty">
                Your meetings will appear here when you start transcribing.
              </p>
            )}
            <ul className="meet-list">
              {groups
                .flatMap((group) => group.meetings)
                .map((meeting) => (
                  <li key={meeting.id}>
                    <div className="meet-meeting">
                      <div className="meet-meta">
                        <strong>
                          Meeting ·{" "}
                          {new Date(meeting.createdAt).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" }
                          )}
                        </strong>
                        <a
                          className="meet-link meet-status"
                          href={meeting.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {meeting.url.replace("https://", "")}
                        </a>
                      </div>
                      <div className="meet-row">
                        <span className="meet-badge">
                          {["queued", "joining", "transcribing"].includes(
                            meeting.state
                          )
                            ? meeting.stopRequested
                              ? "Stopping…"
                              : meeting.state === "transcribing"
                                ? "Transcribing…"
                                : "Connecting…"
                            : meeting.state === "failed"
                              ? meeting.transcriptFile
                                ? "Partial transcript"
                                : "Transcription failed"
                              : meeting.transcriptFile
                                ? "Transcript ready"
                                : "No audio captured"}
                        </span>
                        {meeting.transcriptFile && (
                          <Button
                            onClick={() => setSelected(meeting)}
                            size="sm"
                            variant="outline"
                          >
                            View transcript
                          </Button>
                        )}
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
                            Stop transcription
                          </Button>
                        )}
                        {["finished", "failed"].includes(meeting.state) && (
                          <Button
                            aria-label="Delete meeting"
                            disabled={busy}
                            onClick={() => setDeleting(meeting)}
                            size="icon-sm"
                            title="Delete meeting"
                            variant="outline"
                          >
                            <Delete02Icon aria-hidden size={16} />
                          </Button>
                        )}
                      </div>
                    </div>
                    {meeting.error && <p role="alert">{meeting.error}</p>}
                  </li>
                ))}
            </ul>
          </Card>
        ) : (
          <p>Loading…</p>
        )}
      </section>
    );
  }
  ctx.slots.register("page", Page);
}
