# PostgreSQL (read-only, web-only)

**Development milestone, not chat-ready.** Admin connection management and direct
authenticated web actions are implemented. Agent tools are not exposed, and host
calls carrying a profile/session are rejected. Current Nakama chats are visible to
other organization members and may use additional providers for title generation
and skill review. Before enabling agent reads, implement an approved private
session audience/provider policy across history, streams, branches and background
model calls. There is no environment override for this gate.

The intended agent release lets explicitly granted organization users ask agents
about approved PostgreSQL relations. The connector supports **structured selection**, not arbitrary
SQL: one relation, selected columns, ANDed null-safe equality filters, ordering,
and a row limit. No joins, expressions, writes, stored procedure calls, bulk
exports, messaging channels, API-key/local-token callers, automation, or sub-agents.

## Before enabling

1. An operator approves a database hostname, port, and exact IPv4 addresses.
2. A DBA provisions a dedicated restricted login and reviews all exposed data.
3. The operator supplies externally managed encryption keys.
4. An organization admin installs PostgreSQL in **System → Plugins**, adds a
   connection, selects `schema.table` relations, and explicitly grants users and
   agents. No implicit query access for admins. Test the connection.
5. Stop at connection setup/testing for now. Direct web action requests enforce
   user and selected profile grants; there are no assignable agent tools yet.

Direct web actions do not send results to a model or store them in chat. Saving
currently requires an acknowledgment describing the intended future agent
release: model-provider disclosure and retained chat results. That acknowledgment
does not enable agent access or authorize organization-wide disclosure in this
gated milestone. Before enabling agents, approve and enforce the session audience
and provider policy. Grants authorize access, **not** redistribution to arbitrary
tools or audiences; revocation cannot erase already shared results or backups.
Database names and values are untrusted agent input; never follow instructions in
cells, comments, or names. Tool descriptions and result cards label this boundary;
prompt warnings cannot guarantee prevention of all model-driven exfiltration.

## Operator configuration

Set only on the Nakama server, through your secret manager/service environment:

```text
NAKAMA_POSTGRES_KEY_ID=key-2026-09
NAKAMA_POSTGRES_KEYS={"key-2026-09":"<base64-encoded random 32-byte key>"}
NAKAMA_POSTGRES_NETWORK_POLICY=[{"host":"reports.example.net","port":5432,"addresses":["10.20.30.40"]}]
```

No key or network rule means deny. Keep keys outside the Nakama data directory,
repository, exported backups, and logs. AES-256-GCM binds ciphertext to the
organization, plugin, and connection ID. Only the host decrypts stored passwords.
The initial admin password submission passes through trusted plugin action IPC;
configuration actions are not agent tools. Neither settings responses nor query
results expose credentials. Installed plugin code is trusted OS/browser code,
**not a sandbox**; do not install untrusted packages.

Every resolved IPv4 address must appear in the exact hostname/port rule. The connector
uses cancellable DNS A-record resolution (not `/etc/hosts`) with a 3-second budget
and pins one approved address for the client. IPv6,
loopback, link-local/metadata, unspecified, multicast, and reserved high IPv4
ranges are denied even if listed. No connection URLs/options or Unix sockets are
accepted. The operator must maintain firewall/egress rules too: application checks
are not a process sandbox. Private databases require an existing operator-managed
route/VPN from Nakama; there is no browser tunnel or reverse connector. Update the
allowlist when DNS changes. Only the first approved DNS address is attempted.

TLS is mandatory with certificate-chain and hostname/IP verification. Supply a
PEM CA certificate for a private CA. There is no insecure verification switch.
The application-to-Nakama connection must also use HTTPS outside local testing.

## Database role and data scope

A DBA can adapt this example; do not run it blindly on a shared database:

```sql
CREATE ROLE nakama_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
-- Set a strong password securely, e.g. psql \password nakama_reader.
GRANT CONNECT ON DATABASE reporting TO nakama_reader;
GRANT USAGE ON SCHEMA reports TO nakama_reader;
GRANT SELECT ON reports.orders TO nakama_reader;
ALTER ROLE nakama_reader SET default_transaction_read_only = on;
```

The role must not own exposed relations, create objects in exposed schemas, have
write grants on exposed tables/columns, or belong to another role. Runtime checks
reject these cases, including superuser/BYPASSRLS roles. Apply least privilege
throughout the database, not only to selected tables. Review inherited `PUBLIC`
privileges, database TEMP/CREATE privileges, SECURITY DEFINER functions, views,
operators/types/extensions, and default grants for future objects. Revoking
`PUBLIC` privileges affects other users; a DBA must plan that separately.

Use database grants, selected-column grants, safe views, and RLS for actual data
boundaries. The UI relation list only narrows access. One shared role does not
provide per-Nakama-user RLS identity; use separate connections/roles where needed.
Views can run with owner privileges, so verify their visibility explicitly.

Every operation runs in a `READ ONLY` transaction, with a fixed `pg_catalog`
search path. Values are bound; identifiers come from checked metadata and are
quoted. No model SQL is accepted. **SQL filtering and READ ONLY do not neutralize
every side effect of database functions, views, custom types or extensions.** Only
connect databases administered by trusted people. Future writes require a separate
design and authorization, not removal of this transaction setting.

## Limits, lifecycle, rotation, and backups

- One client (`max: 1`) per action, closed on success/error/cancellation. A pinned
  Postgres.js patch destroys and awaits the owned socket on forced termination.
  We avoid its `Query.cancel()` auxiliary-connection unhandled-rejection defect.
  PostgreSQL may continue a disconnected query until its 10-second statement
  timeout before noticing the disconnect. Existing
  host admission permits four actions per organization/plugin; it is not a
  cluster-wide database connection quota. Use operator/database limits too.
- 3-second DNS, 5-second connect, 10-second statement, 2-second lock, 5-second idle-transaction,
  and 20-second operation deadlines, within the host action budget.
- Up to 200 rows, 40 columns, 10 equality filters. Rows over 32 KiB are omitted;
  row payload stops at 240,000 bytes to leave room within 256 KiB for metadata.
  Schema responses show at most 200 columns. Truncation is explicit.
- A very wide server row is decoded before its size is checked. Configure server
  memory limits and expose bounded views; this is not a hard wire/memory cap.
- Big integers, numerics and dates preserve precision as strings where needed;
  column metadata includes PostgreSQL type OIDs. JSON values remain JSON.
- Saving uses optimistic revisions. Grant/config changes and deletion invalidate
  in-flight results at authorization checkpoints; they do not synchronously
  terminate every upstream query. Disable the plugin to cancel/drain its actions.
- Credential rotation: change the database password, then edit the connection and
  supply the replacement. Blank keeps the current password. Destination/role
  changes require a replacement. Old credentials must be revoked upstream.
- Master-key rotation: add a new key alongside old keys, select its ID, restart
  the server, and save each connection to re-encrypt with the active key. Keep old
  keys for backups that still need them; test restore before retiring keys.
- Backups contain encrypted credentials, not master keys. Back up keys separately.
  Missing/wrong keys fail closed. Restored plugins remain disabled; review grants,
  destination policy and credentials before enabling. Uninstall retains plugin
  data; explicit retained-data deletion removes it. Connection deletion does not
  cryptographically erase SQLite free pages, historical backups, or prior chats.
- Audit records contain actor/profile/connection/action/status/timing, no SQL,
  filter values, credentials or rows; retain the newest 1,000 records per plugin DB.

## Build and verification

Requires the Nakama host capability shipped with this plugin; installing the npm
package on an older host is insufficient. Bundle artifacts with:

```sh
bun install --frozen-lockfile
bun run --cwd packages/plugins/postgresql build
bun test apps/server/src/services/postgres-plugin.test.ts
```

To produce the installable package, run `npm pack --ignore-scripts` from
`packages/plugins/postgresql` after building. This includes the manifest, bundled
actions/UI, migrations and README. Use npm here: `bun pm pack` cannot resolve
versions for this repository's unversioned private workspace development
dependencies. Those type-only dependencies are not needed by the installed plugin.

Disposable integration tests require PostgreSQL binaries and OpenSSL. Provide a
private IPv4 assigned **on the test machine**, never a customer database address:

```sh
# Linux test runner preparation, if needed:
sudo ip addr add 10.77.0.1/32 dev lo
NAKAMA_TEST_POSTGRES_IP=10.77.0.1 bash scripts/test-postgresql-plugin.sh
sudo ip addr del 10.77.0.1/32 dev lo
```

The script initializes a temporary cluster, generates a test certificate, creates
disposable roles/data, runs tests, stops PostgreSQL, and removes the cluster.
It must run as a non-root user. No real database credentials are required.

References: [PostgreSQL read-only transactions](https://www.postgresql.org/docs/current/sql-set-transaction.html),
[privileges](https://www.postgresql.org/docs/current/ddl-priv.html),
[timeouts](https://www.postgresql.org/docs/current/runtime-config-client.html),
[Postgres.js](https://github.com/porsager/postgres).
