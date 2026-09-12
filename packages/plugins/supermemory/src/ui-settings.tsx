/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as ReactType from "react";
import { type Context, errorText } from "./ui-context";
export function createSettings(ctx: Context) {
  const React = ctx.React;
  const { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle } =
    ctx.ui;
  function Settings({
    close,
    saved,
  }: {
    close: () => void;
    saved: () => void;
  }) {
    const [url, setUrl] = React.useState("");
    const [token, setToken] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [managed, setManaged] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);
    React.useEffect(() => {
      let alive = true;
      ctx.host
        .call("get_settings")
        .then((value) => {
          if (alive) {
            const settings = value as {
              managed?: boolean;
              url?: string;
            };
            setManaged(!!settings.managed);
            setUrl(settings.url ?? "");
            setLoaded(true);
          }
        })
        .catch((error) => {
          if (alive) {
            setMessage(errorText(error));
          }
        });
      return () => {
        alive = false;
      };
    }, []);
    async function save(event: ReactType.FormEvent) {
      event.preventDefault();
      setBusy(true);
      setMessage("");
      try {
        await ctx.host.call("save_settings", {
          token: token || undefined,
          url,
        });
        setToken("");
        saved();
      } catch (error) {
        setMessage(errorText(error));
      } finally {
        setBusy(false);
      }
    }
    async function check() {
      setBusy(true);
      setMessage("");
      try {
        await ctx.host.call("check_connection");
        setMessage("Connected to saved server");
      } catch (error) {
        setMessage(errorText(error));
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
            <DialogTitle>Supermemory settings</DialogTitle>
          </DialogHeader>
          {loaded ? (
            <form className="sm-stack" onSubmit={save}>
              {managed ? (
                <p>
                  Supermemory automatically uses your saved OpenAI provider.
                </p>
              ) : (
                <>
                  <label>
                    Server URL
                    <Input
                      onChange={(event) => setUrl(event.target.value)}
                      required
                      value={url}
                    />
                  </label>
                  <label>
                    API token
                    <Input
                      autoComplete="new-password"
                      onChange={(event) => setToken(event.target.value)}
                      type="password"
                      value={token}
                    />
                  </label>
                  <p>Leave the token blank to keep it for the same server.</p>
                </>
              )}
              {message && <p role="status">{message}</p>}
              <div className="sm-row">
                <Button disabled={busy || !loaded || managed} type="submit">
                  Save
                </Button>
                {!managed && (
                  <Button
                    disabled={busy}
                    onClick={check}
                    type="button"
                    variant="outline"
                  >
                    Check saved connection
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p role="status">{message || "Loading…"}</p>
          )}
        </DialogContent>
      </Dialog>
    );
  }
  return Settings;
}
