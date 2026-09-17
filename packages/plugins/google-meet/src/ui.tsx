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
  authenticated: boolean;
  canConfigure: boolean;
  worker: { state: string; message?: string };
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";
export const inject = ["slots", "host", "styles", "ui"];

export function apply(ctx: Context) {
  const React = ctx.React;
  const { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle } =
    ctx.ui;
  ctx.styles(
    ".meet-page{display:grid;gap:16px;max-width:960px;width:100%;min-width:0}.meet-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.meet-form{display:grid;gap:12px}.meet-form label{display:grid;gap:6px}.meet-list{list-style:none;padding:0;margin:0}.meet-list li{padding:16px 0;border-bottom:1px solid var(--border)}.meet-transcript{white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto}.meet-url{flex:1;min-width:180px}.meet-status{font-size:13px;color:var(--muted-foreground)}"
  );

  function Settings({ close }: { close(): void }) {
    const [apiKey, setApiKey] = React.useState("");
    const [connection, setConnection] = React.useState<{
      state: string;
      authenticated: boolean;
      url?: string;
      error?: string;
    } | null>(null);
    React.useEffect(() => {
      let alive = true;
      let running = false;
      const refresh = async () => {
        if (!alive || running || ctx.signal.aborted) {
          return;
        }
        running = true;
        try {
          const value = await ctx.host.call("connection");
          if (alive) {
            setConnection(value as typeof connection);
          }
        } catch (reason) {
          if (alive) {
            setError(message(reason));
          }
        } finally {
          running = false;
        }
      };
      void refresh();
      const timer = setInterval(() => void refresh(), 2000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);
    async function login(action: string) {
      setBusy(true);
      setError("");
      try {
        setConnection((await ctx.host.call(action)) as typeof connection);
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    }
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
            <div className="meet-row">
              <Button
                disabled={
                  busy ||
                  connection?.state === "starting" ||
                  connection?.state === "saving"
                }
                onClick={() => void login("connect")}
                type="button"
                variant="outline"
              >
                {connection?.authenticated
                  ? "Reconnect Google"
                  : "Connect Google"}
              </Button>
              {connection?.url && (
                <>
                  <a
                    href={connection.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Open sign-in browser
                  </a>
                  <Button
                    disabled={busy || connection.state === "saving"}
                    onClick={() => void login("finish-login")}
                    type="button"
                  >
                    Finish sign-in
                  </Button>
                </>
              )}
              {(connection?.authenticated || connection?.url) && (
                <Button
                  disabled={busy || connection.state === "saving"}
                  onClick={() => void login("disconnect")}
                  type="button"
                  variant="outline"
                >
                  Disconnect Google
                </Button>
              )}
            </div>
            <p className="meet-status">
              {connection?.state === "starting"
                ? "Starting browser…"
                : connection?.state === "saving"
                  ? "Updating Google connection…"
                  : connection?.url
                    ? "Complete Google sign-in in the browser, then select Finish sign-in."
                    : connection?.authenticated
                      ? "Google connected"
                      : "Google disconnected"}
            </p>
            {connection?.error && <p role="alert">{connection.error}</p>}
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
            <DialogTitle>Meeting transcript</DialogTitle>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <div className="meet-transcript">{text || "Waiting for speech…"}</div>
          <Button disabled={!text} onClick={download}>
            Download transcript
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  function Page() {
    const [overview, setOverview] = React.useState<Overview | null>(null);
    const [error, setError] = React.useState("");
    const [url, setUrl] = React.useState("");
    const [duration, setDuration] = React.useState(30);
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
        await ctx.host.call(name, input);
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
    return (
      <section className="meet-page">
        <div className="meet-row">
          <h1>Google Meet</h1>
          {overview?.canConfigure && (
            <Button onClick={() => setSettings(true)} variant="outline">
              Settings
            </Button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {overview && (
          <p className="meet-status">
            {overview.configured
              ? overview.authenticated
                ? overview.worker.state === "ready"
                  ? "Ready"
                  : "Start Google Meet in Workers."
                : "Connect Google in Settings."
              : "Set a transcription API key in Settings."}
          </p>
        )}
        <form
          className="meet-row"
          onSubmit={(event) => {
            event.preventDefault();
            void action("join", { durationMinutes: duration, url });
          }}
        >
          <Input
            aria-label="Google Meet URL"
            className="meet-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            required
            type="url"
            value={url}
          />
          <label>
            Minutes{" "}
            <Input
              aria-label="Maximum meeting minutes"
              max={55}
              min={1}
              onChange={(event) => setDuration(Number(event.target.value))}
              style={{ width: 90 }}
              type="number"
              value={duration}
            />
          </label>
          <Button
            disabled={
              busy ||
              active ||
              !overview?.configured ||
              !overview.authenticated ||
              overview.worker.state !== "ready"
            }
            type="submit"
          >
            Join and transcribe
          </Button>
        </form>
        {overview ? (
          overview.meetings.length ? (
            <ul className="meet-list">
              {overview.meetings.map((meeting) => (
                <li key={meeting.id}>
                  <div className="meet-row">
                    <a href={meeting.url} rel="noreferrer" target="_blank">
                      {meeting.url}
                    </a>
                    <span className="meet-status">
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
                      variant="outline"
                    >
                      Transcript
                    </Button>
                    {["queued", "joining", "transcribing"].includes(
                      meeting.state
                    ) && (
                      <Button
                        disabled={busy || !!meeting.stopRequested}
                        onClick={() =>
                          void action("leave", { meetingId: meeting.id })
                        }
                        variant="outline"
                      >
                        Leave
                      </Button>
                    )}
                  </div>
                  {meeting.error && <p role="alert">{meeting.error}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No meetings yet.</p>
          )
        ) : (
          <p>Loading…</p>
        )}
        {settings && <Settings close={() => setSettings(false)} />}
        {selected && (
          <Transcript close={() => setSelected(null)} meeting={selected} />
        )}
      </section>
    );
  }
  ctx.slots.register("page", Page);
}
