/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import { createBrowser } from "./ui-browser";
import {
  asJsonRecord,
  type Context,
  errorText,
  type Profile,
  readJsonString,
} from "./ui-context";
import { createSettings } from "./ui-settings";

function usePage(ctx: Context) {
  const React = ctx.React;
  const [profiles, setProfiles] = React.useState<Profile[]>([]);
  const [canConfigure, setCanConfigure] = React.useState(false);
  const [configured, setConfigured] = React.useState(false);
  const [settings, setSettings] = React.useState(false);

  const [worker, setWorker] = React.useState<{
    state: string;
    message?: string;
  } | null>(null);

  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    let inFlight = false;

    const refresh = () => {
      if (inFlight || !alive || ctx.signal.aborted) {
        return;
      }

      inFlight = true;

      return ctx.host
        .call("profiles")
        .then((value) => {
          if (!alive || ctx.signal.aborted) {
            return;
          }

          const result = asJsonRecord(value);

          if (!(result && Array.isArray(result.profiles))) {
            throw new Error("Invalid profile response");
          }

          const profiles = result.profiles.flatMap((profile) => {
            const record = asJsonRecord(profile);
            const id = record && readJsonString(record.id);
            const name = record && readJsonString(record.name);

            return id && name ? [{ id, name }] : [];
          });

          const workerRecord = result.worker && asJsonRecord(result.worker);

          const workerState =
            workerRecord && readJsonString(workerRecord.state);

          const workerMessage =
            workerRecord && readJsonString(workerRecord.message);

          setError("");
          setWorker(
            workerState
              ? { message: workerMessage ?? undefined, state: workerState }
              : null
          );
          setProfiles(profiles);
          setConfigured(result.configured === true);
          setCanConfigure(result.canConfigure === true);
        })
        .catch((reason) => {
          if (alive) {
            setError(
              errorText(reason instanceof Error ? reason : "Request failed")
            );
          }
        })
        .finally(() => {
          inFlight = false;

          if (alive) {
            setLoading(false);
          }
        });
    };

    void refresh();
    const timer = setInterval(() => void refresh(), 3000);

    return () => {
      clearInterval(timer);
      alive = false;
    };
  }, []);

  return {
    canConfigure,
    configured,
    error,
    loading,
    profiles,
    setConfigured,
    setSettings,
    settings,
    worker,
  };
}

export function createPage(ctx: Context) {
  const React = ctx.React;
  const { Button } = ctx.ui;
  const Settings = createSettings(ctx);
  const Browser = createBrowser(ctx);

  function Page() {
    const {
      profiles,
      worker,
      canConfigure,
      configured,
      setConfigured,
      settings,
      setSettings,
      error,
      loading,
    } = usePage(ctx);

    const controls = (
      <div className="sm-row sm-controls">
        {configured && <span className="sm-ready">Ready</span>}
        {canConfigure && (
          <Button onClick={() => setSettings(true)} variant="ghost">
            Settings
          </Button>
        )}
      </div>
    );

    return (
      <section aria-label="Supermemory" className="sm-page sm-stack">
        {!configured && controls}
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">Loading…</p>
        ) : configured ? (
          <Browser controls={controls} profiles={profiles} />
        ) : (
          <div className="sm-stack">
            <p role={worker?.state === "error" ? "alert" : "status"}>
              {worker?.message ||
                (worker?.state === "stopped"
                  ? "Supermemory is stopped."
                  : "Preparing Supermemory…")}
            </p>
            <a href="/workers">Open Workers</a>
          </div>
        )}
        {settings && (
          <Settings
            close={() => setSettings(false)}
            saved={() => {
              setConfigured(true);
              setSettings(false);
            }}
          />
        )}
      </section>
    );
  }

  return Page;
}
