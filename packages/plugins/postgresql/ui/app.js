// src/ui.tsx
var inject = ["slots", "host", "styles", "ui"];
var empty = () => ({
  ca: "",
  database: "",
  disclosureAccepted: false,
  host: "",
  name: "",
  port: 5432,
  profileIds: [],
  relations: [],
  userIds: [],
  username: ""
});
function apply(ctx) {
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
  function QueryResult({ result, status }) {
    if (status === "running") {
      return /* @__PURE__ */ React.createElement("p", null, "Reading PostgreSQL…");
    }
    const data = result;
    if (!(Array.isArray(data?.columns) && Array.isArray(data?.rows))) {
      return /* @__PURE__ */ React.createElement("p", {
        role: "alert"
      }, data?.error ?? "No tabular result");
    }
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, "Untrusted database data · ", data.rows.length, " rows", data.truncated ? " · Truncated" : ""), /* @__PURE__ */ React.createElement("div", {
      className: "pg-results"
    }, /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, data.columns.map((col, index) => /* @__PURE__ */ React.createElement("th", {
      key: `${index}-${col.name}`
    }, col.name)))), /* @__PURE__ */ React.createElement("tbody", null, data.rows.map((row, index) => /* @__PURE__ */ React.createElement("tr", {
      key: index
    }, row.map((cell, column) => /* @__PURE__ */ React.createElement("td", {
      key: column
    }, cell === null ? "NULL" : typeof cell === "object" ? JSON.stringify(cell) : String(cell)))))))));
  }
  function Page() {
    const [overview, setOverview] = React.useState(null);
    const [editing, setEditing] = React.useState(null);
    const [deleting, setDeleting] = React.useState(null);
    const [config, setConfig] = React.useState(null);
    const [relations, setRelations] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const load = async () => setOverview(await ctx.host.call("overview"));
    React.useEffect(() => {
      let active = true;
      ctx.host.call("overview").then((value) => {
        if (active) {
          setOverview(value);
        }
      }).catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load connections");
        }
      });
      return () => {
        active = false;
      };
    }, []);
    const perform = async (work) => {
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
    const edit = (connection) => {
      setEditing(connection);
      setConfig(connection?.config ? { ...connection.config, disclosureAccepted: false } : empty());
      setRelations(connection?.config?.relations.map((item) => `${item.schema}.${item.table}`).join(`
`) ?? "");
      setPassword("");
      setError("");
      setMessage("");
    };
    const toggle = (field, id) => setConfig((old) => old ? {
      ...old,
      [field]: old[field].includes(id) ? old[field].filter((value) => value !== id) : [...old[field], id]
    } : old);
    return /* @__PURE__ */ React.createElement("div", {
      className: "pg-page"
    }, /* @__PURE__ */ React.createElement("div", {
      className: "pg-row"
    }, /* @__PURE__ */ React.createElement("h2", null, "PostgreSQL connections"), overview?.canConfigure && !config && /* @__PURE__ */ React.createElement(Button, {
      onClick: () => edit(null)
    }, "Add connection")), /* @__PURE__ */ React.createElement("p", {
      className: "pg-notice"
    }, "Agent tools are disabled pending private chat audience and provider enforcement. Connection setup and testing are available; this is not yet a chat-ready release."), /* @__PURE__ */ React.createElement("p", {
      className: "pg-notice"
    }, overview?.disclosure ?? "Authenticated web access only. Database results may be sent to the configured model provider and retained in chat."), error && /* @__PURE__ */ React.createElement("p", {
      role: "alert"
    }, error), message && /* @__PURE__ */ React.createElement("p", {
      role: "status"
    }, message), !(overview || error) && /* @__PURE__ */ React.createElement("p", null, "Loading connections…"), overview?.connections.length === 0 && !config && /* @__PURE__ */ React.createElement("p", null, "No connections available. An organization admin must configure a connection and grant access to both you and your agent."), !config && overview?.connections.map((connection) => /* @__PURE__ */ React.createElement(Card, {
      className: "pg-card",
      key: connection.id
    }, /* @__PURE__ */ React.createElement("div", {
      className: "pg-row"
    }, /* @__PURE__ */ React.createElement("strong", null, connection.name), overview.canConfigure && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => edit(connection),
      variant: "outline"
    }, "Edit"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => perform(async () => {
        await ctx.host.call("test_connection", {
          connectionId: connection.id
        });
        setMessage(`${connection.name}: verified TLS and read-only role checks passed.`);
      }),
      variant: "outline"
    }, "Test"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => setDeleting(connection),
      variant: "outline"
    }, "Delete"))), /* @__PURE__ */ React.createElement("code", null, connection.id), /* @__PURE__ */ React.createElement("p", null, "Connection prepared. Agent tools remain disabled until chat disclosure controls are implemented."))), deleting && /* @__PURE__ */ React.createElement(ConfirmDialog, {
      confirmLabel: "Delete connection",
      description: "Existing chat results and backups remain. Revoke the database credential separately.",
      onClose: () => setDeleting(null),
      onConfirm: async () => {
        await ctx.host.call("delete_connection", {
          connectionId: deleting.id,
          revision: deleting.revision
        });
        setDeleting(null);
        await load();
      },
      title: "Delete connection?"
    }), config && /* @__PURE__ */ React.createElement(Card, {
      className: "pg-card"
    }, /* @__PURE__ */ React.createElement("form", {
      onSubmit: (event) => {
        event.preventDefault();
        perform(async () => {
          const selected = relations.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
            const parts = line.split(".");
            if (parts.length !== 2) {
              throw new Error("Use schema.table, one relation per line");
            }
            return { schema: parts[0], table: parts[1] };
          });
          await ctx.host.call("save_connection", {
            ...editing ? { id: editing.id } : {},
            config: { ...config, relations: selected },
            revision: editing?.revision ?? 0,
            ...password ? { password } : {}
          });
          setPassword("");
          setConfig(null);
          await load();
          setMessage("Connection saved. Test the network, TLS and database role.");
        });
      }
    }, /* @__PURE__ */ React.createElement("div", {
      className: "pg-grid"
    }, ["name", "host", "database", "username"].map((field) => /* @__PURE__ */ React.createElement("label", {
      key: field
    }, {
      database: "Database",
      host: "Approved hostname or IPv4",
      name: "Name",
      username: "Read-only database role"
    }[field], /* @__PURE__ */ React.createElement(Input, {
      onChange: (e) => setConfig({ ...config, [field]: e.target.value }),
      required: true,
      value: config[field]
    }))), /* @__PURE__ */ React.createElement("label", null, "Port", /* @__PURE__ */ React.createElement(Input, {
      max: 65535,
      min: 1,
      onChange: (e) => setConfig({ ...config, port: Number(e.target.value) }),
      required: true,
      type: "number",
      value: config.port
    })), /* @__PURE__ */ React.createElement("label", null, editing ? "Replacement password (blank keeps current)" : "Password", /* @__PURE__ */ React.createElement(Input, {
      autoComplete: "new-password",
      onChange: (e) => setPassword(e.target.value),
      required: !editing,
      type: "password",
      value: password
    })), /* @__PURE__ */ React.createElement("label", null, "Approved relations (schema.table per line)", /* @__PURE__ */ React.createElement("textarea", {
      onChange: (e) => setRelations(e.target.value),
      required: true,
      value: relations
    })), /* @__PURE__ */ React.createElement("label", null, "CA certificate (optional PEM)", /* @__PURE__ */ React.createElement("textarea", {
      onChange: (e) => setConfig({ ...config, ca: e.target.value }),
      value: config.ca
    })), /* @__PURE__ */ React.createElement("fieldset", null, /* @__PURE__ */ React.createElement("legend", null, "Granted users"), overview?.members?.map((item) => /* @__PURE__ */ React.createElement("label", {
      className: "pg-check",
      key: item.id
    }, /* @__PURE__ */ React.createElement("input", {
      checked: config.userIds.includes(item.id),
      onChange: () => toggle("userIds", item.id),
      type: "checkbox"
    }), item.id, " (", item.role, ")"))), /* @__PURE__ */ React.createElement("fieldset", null, /* @__PURE__ */ React.createElement("legend", null, "Granted agents"), overview?.profiles?.map((item) => /* @__PURE__ */ React.createElement("label", {
      className: "pg-check",
      key: item.id
    }, /* @__PURE__ */ React.createElement("input", {
      checked: config.profileIds.includes(item.id),
      onChange: () => toggle("profileIds", item.id),
      type: "checkbox"
    }), item.name)))), /* @__PURE__ */ React.createElement("p", {
      className: "pg-notice"
    }, "The role must have SELECT-only access to approved data. Read-only transactions cannot neutralize all effects of views, functions or extensions. Only connect databases administered by someone you trust."), /* @__PURE__ */ React.createElement("label", {
      className: "pg-check"
    }, /* @__PURE__ */ React.createElement("input", {
      checked: config.disclosureAccepted,
      onChange: (e) => setConfig({
        ...config,
        disclosureAccepted: e.target.checked
      }),
      required: true,
      type: "checkbox"
    }), "I authorize granted users and agents to send database results to the configured model provider and retain them in web chat. Revoking access does not erase prior results."), /* @__PURE__ */ React.createElement("div", {
      className: "pg-row"
    }, /* @__PURE__ */ React.createElement(Button, {
      disabled: busy || !config.disclosureAccepted,
      type: "submit"
    }, busy ? "Saving…" : "Save connection"), /* @__PURE__ */ React.createElement(Button, {
      disabled: busy,
      onClick: () => {
        setConfig(null);
        setPassword("");
      },
      type: "button",
      variant: "outline"
    }, "Cancel")))));
  }
  ctx.slots.register("page", Page);
  ctx.slots.register("tool:query", QueryResult);
}
export {
  apply,
  inject
};
