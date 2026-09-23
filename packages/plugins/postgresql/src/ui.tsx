/** @jsxRuntime classic */
/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import type * as UI from "@nakama/ui";
import type * as ReactType from "react";

type Config = {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ca: string;
  relations: Array<{ schema: string; table: string }>;
  userIds: string[];
  profileIds: string[];
  disclosureAccepted: boolean;
};
type Connection = {
  id: string;
  revision: number;
  name: string;
  config?: Config;
};
type Overview = {
  connections: Connection[];
  canConfigure: boolean;
  disclosure: string;
  members?: Array<{ id: string; role: string }>;
  profiles?: Array<{ id: string; name: string }>;
};
type ToolProps = { result?: unknown; status: "running" | "done" };
type Context = {
  React: typeof ReactType;
  ui: typeof UI;
  host: { call(action: string, input?: unknown): Promise<unknown> };
  slots: {
    register(slot: "page", component: ReactType.ComponentType): void;
    register(
      slot: "tool:query",
      component: ReactType.ComponentType<ToolProps>
    ): void;
  };
  styles(css: string): void;
};
export const inject = ["slots", "host", "styles", "ui"];
const empty = (): Config => ({
  ca: "",
  database: "",
  disclosureAccepted: false,
  host: "",
  name: "",
  port: 5432,
  profileIds: [],
  relations: [],
  userIds: [],
  username: "",
});

export function apply(ctx: Context) {
  const React = ctx.React;
  const { Button, Input, Card, ConfirmDialog } = ctx.ui;
  ctx.styles(`[data-plugin-id="postgresql"] .pg-page{max-width:850px;margin:auto;display:grid;gap:20px;padding:8px}
    [data-plugin-id="postgresql"] .pg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
    [data-plugin-id="postgresql"] label{display:grid;gap:6px;font-size:14px}
    [data-plugin-id="postgresql"] textarea{width:100%;min-height:80px;border:1px solid var(--border);border-radius:6px;background:var(--background);padding:8px;font:inherit}
    [data-plugin-id="postgresql"] .pg-card{padding:18px;display:grid;gap:14px}
    [data-plugin-id="postgresql"] .pg-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    [data-plugin-id="postgresql"] label.pg-check{display:flex;gap:8px;align-items:flex-start}
    [data-plugin-id="postgresql"] .pg-notice{font-size:14px;border-left:3px solid var(--primary);padding:10px 14px;background:var(--muted)}
    [data-plugin-id="postgresql"] [role="alert"]{color:var(--destructive)}
    [data-plugin-id="postgresql"] .pg-results{overflow:auto;max-height:420px}
    [data-plugin-id="postgresql"] table{border-collapse:collapse;width:100%;font-size:13px}
    [data-plugin-id="postgresql"] th,[data-plugin-id="postgresql"] td{border:1px solid var(--border);padding:6px;text-align:left;max-width:320px;overflow-wrap:anywhere;white-space:pre-wrap}`);
  function QueryResult({ result, status }: ToolProps) {
    if (status === "running") {
      return <p>Reading PostgreSQL…</p>;
    }
    const data = result as
      | {
          columns?: Array<{ name: string }>;
          rows?: unknown[][];
          truncated?: boolean;
          error?: string;
        }
      | undefined;
    if (!(Array.isArray(data?.columns) && Array.isArray(data?.rows))) {
      return <p role="alert">{data?.error ?? "No tabular result"}</p>;
    }
    return (
      <div>
        <p>
          Untrusted database data · {data.rows.length} rows
          {data.truncated ? " · Truncated" : ""}
        </p>
        <div className="pg-results">
          <table>
            <thead>
              <tr>
                {data.columns.map((col, index) => (
                  <th key={`${index}-${col.name}`}>{col.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>
                      {cell === null
                        ? "NULL"
                        : typeof cell === "object"
                          ? JSON.stringify(cell)
                          : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  function Page() {
    const [overview, setOverview] = React.useState<Overview | null>(null);
    const [editing, setEditing] = React.useState<Connection | null>(null);
    const [deleting, setDeleting] = React.useState<Connection | null>(null);
    const [config, setConfig] = React.useState<Config | null>(null);
    const [relations, setRelations] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const load = async () =>
      setOverview((await ctx.host.call("overview")) as Overview);
    React.useEffect(() => {
      let active = true;
      ctx.host
        .call("overview")
        .then((value) => {
          if (active) {
            setOverview(value as Overview);
          }
        })
        .catch((e) => {
          if (active) {
            setError(
              e instanceof Error ? e.message : "Could not load connections"
            );
          }
        });
      return () => {
        active = false;
      };
    }, []);
    const perform = async (work: () => Promise<void>) => {
      setBusy(true);
      setError("");
      setMessage("");
      try {
        await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setBusy(false);
      }
    };
    const edit = (connection: Connection | null) => {
      setEditing(connection);
      setConfig(
        connection?.config
          ? { ...connection.config, disclosureAccepted: false }
          : empty()
      );
      setRelations(
        connection?.config?.relations
          .map((item) => `${item.schema}.${item.table}`)
          .join("\n") ?? ""
      );
      setPassword("");
      setError("");
      setMessage("");
    };
    const toggle = (field: "userIds" | "profileIds", id: string) =>
      setConfig((old) =>
        old
          ? {
              ...old,
              [field]: old[field].includes(id)
                ? old[field].filter((value) => value !== id)
                : [...old[field], id],
            }
          : old
      );
    return (
      <div className="pg-page">
        <div className="pg-row">
          <h2>PostgreSQL connections</h2>
          {overview?.canConfigure && !config && (
            <Button onClick={() => edit(null)}>Add connection</Button>
          )}
        </div>
        <p className="pg-notice">
          Agent tools are disabled pending private chat audience and provider
          enforcement. Connection setup and testing are available; this is not
          yet a chat-ready release.
        </p>
        <p className="pg-notice">
          {overview?.disclosure ??
            "Authenticated web access only. Database results may be sent to the configured model provider and retained in chat."}
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {!(overview || error) && <p>Loading connections…</p>}
        {overview?.connections.length === 0 && !config && (
          <p>
            No connections available. An organization admin must configure a
            connection and grant access to both you and your agent.
          </p>
        )}
        {!config &&
          overview?.connections.map((connection) => (
            <Card className="pg-card" key={connection.id}>
              <div className="pg-row">
                <strong>{connection.name}</strong>
                {overview.canConfigure && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => edit(connection)}
                      variant="outline"
                    >
                      Edit
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        perform(async () => {
                          await ctx.host.call("test_connection", {
                            connectionId: connection.id,
                          });
                          setMessage(
                            `${connection.name}: verified TLS and read-only role checks passed.`
                          );
                        })
                      }
                      variant="outline"
                    >
                      Test
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => setDeleting(connection)}
                      variant="outline"
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
              <code>{connection.id}</code>
              <p>
                Connection prepared. Agent tools remain disabled until chat
                disclosure controls are implemented.
              </p>
            </Card>
          ))}
        {deleting && (
          <ConfirmDialog
            confirmLabel="Delete connection"
            description="Existing chat results and backups remain. Revoke the database credential separately."
            onClose={() => setDeleting(null)}
            onConfirm={async () => {
              await ctx.host.call("delete_connection", {
                connectionId: deleting.id,
                revision: deleting.revision,
              });
              setDeleting(null);
              await load();
            }}
            title="Delete connection?"
          />
        )}
        {config && (
          <Card className="pg-card">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  const selected = relations
                    .split(/\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const parts = line.split(".");
                      if (parts.length !== 2) {
                        throw new Error(
                          "Use schema.table, one relation per line"
                        );
                      }
                      return { schema: parts[0], table: parts[1] };
                    });
                  await ctx.host.call("save_connection", {
                    ...(editing ? { id: editing.id } : {}),
                    config: { ...config, relations: selected },
                    revision: editing?.revision ?? 0,
                    ...(password ? { password } : {}),
                  });
                  setPassword("");
                  setConfig(null);
                  await load();
                  setMessage(
                    "Connection saved. Test the network, TLS and database role."
                  );
                });
              }}
            >
              <div className="pg-grid">
                {(["name", "host", "database", "username"] as const).map(
                  (field) => (
                    <label key={field}>
                      {
                        {
                          database: "Database",
                          host: "Approved hostname or IPv4",
                          name: "Name",
                          username: "Read-only database role",
                        }[field]
                      }
                      <Input
                        onChange={(e) =>
                          setConfig({ ...config, [field]: e.target.value })
                        }
                        required
                        value={config[field]}
                      />
                    </label>
                  )
                )}
                <label>
                  Port
                  <Input
                    max={65_535}
                    min={1}
                    onChange={(e) =>
                      setConfig({ ...config, port: Number(e.target.value) })
                    }
                    required
                    type="number"
                    value={config.port}
                  />
                </label>
                <label>
                  {editing
                    ? "Replacement password (blank keeps current)"
                    : "Password"}
                  <Input
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                    required={!editing}
                    type="password"
                    value={password}
                  />
                </label>
                <label>
                  Approved relations (schema.table per line)
                  <textarea
                    onChange={(e) => setRelations(e.target.value)}
                    required
                    value={relations}
                  />
                </label>
                <label>
                  CA certificate (optional PEM)
                  <textarea
                    onChange={(e) =>
                      setConfig({ ...config, ca: e.target.value })
                    }
                    value={config.ca}
                  />
                </label>
                <fieldset>
                  <legend>Granted users</legend>
                  {overview?.members?.map((item) => (
                    <label className="pg-check" key={item.id}>
                      <input
                        checked={config.userIds.includes(item.id)}
                        onChange={() => toggle("userIds", item.id)}
                        type="checkbox"
                      />
                      {item.id} ({item.role})
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Granted agents</legend>
                  {overview?.profiles?.map((item) => (
                    <label className="pg-check" key={item.id}>
                      <input
                        checked={config.profileIds.includes(item.id)}
                        onChange={() => toggle("profileIds", item.id)}
                        type="checkbox"
                      />
                      {item.name}
                    </label>
                  ))}
                </fieldset>
              </div>
              <p className="pg-notice">
                The role must have SELECT-only access to approved data.
                Read-only transactions cannot neutralize all effects of views,
                functions or extensions. Only connect databases administered by
                someone you trust.
              </p>
              <label className="pg-check">
                <input
                  checked={config.disclosureAccepted}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      disclosureAccepted: e.target.checked,
                    })
                  }
                  required
                  type="checkbox"
                />
                I authorize granted users and agents to send database results to
                the configured model provider and retain them in web chat.
                Revoking access does not erase prior results.
              </label>
              <div className="pg-row">
                <Button
                  disabled={busy || !config.disclosureAccepted}
                  type="submit"
                >
                  {busy ? "Saving…" : "Save connection"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setConfig(null);
                    setPassword("");
                  }}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    );
  }
  ctx.slots.register("page", Page);
  ctx.slots.register("tool:query", QueryResult);
}
