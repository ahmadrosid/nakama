/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */

import { createBrowser } from "./ui-browser";
import { type Context, errorText, type Profile } from "./ui-context";
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
          const result = value as {
            profiles: Profile[];
            configured: boolean;
            canConfigure: boolean;
            worker?: { state: string; message?: string };
          };
          setError("");
          setWorker(result.worker ?? null);
          setProfiles(result.profiles);
          setConfigured(result.configured);
          setCanConfigure(result.canConfigure);
        })
        .catch((reason) => {
          if (alive) {
            setError(errorText(reason));
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
    return (
      <section className="sm-page sm-stack">
        <header className="sm-row">
          <h1 className="sm-title">Supermemory</h1>
          {configured && <span>Ready</span>}
          {canConfigure && (
            <Button onClick={() => setSettings(true)} variant="outline">
              Settings
            </Button>
          )}
        </header>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">Loading…</p>
        ) : configured ? (
          <Browser profiles={profiles} />
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
