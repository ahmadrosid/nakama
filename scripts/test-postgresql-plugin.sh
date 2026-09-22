#!/usr/bin/env bash
set -euo pipefail
# Disposable local database only. Requires PostgreSQL binaries, openssl, and an
# existing private IPv4 address (loopback/link-local remain denied in production).
ROOT=$(git rev-parse --show-toplevel)
PG_BIN=${PG_BIN:-$(pg_config --bindir)}
TEST_IP=${NAKAMA_TEST_POSTGRES_IP:?Set NAKAMA_TEST_POSTGRES_IP to a local private IPv4 address}
DIR=$(mktemp -d)
cleanup() {
  "$PG_BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DIR/data" --auth-local=trust --auth-host=scram-sha-256 >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/data/server.key" -out "$DIR/data/server.crt" -days 1 -subj /CN=nakama-postgres-test -addext "subjectAltName=IP:$TEST_IP" >/dev/null 2>&1
openssl req -x509 -key "$DIR/data/server.key" -out "$DIR/wrong.crt" -days 1 -subj /CN=wrong.example.test -addext "subjectAltName=DNS:wrong.example.test" >/dev/null 2>&1
chmod 600 "$DIR/data/server.key"
PORT=${NAKAMA_TEST_POSTGRES_PORT:-15432}
cat >> "$DIR/data/postgresql.conf" <<EOF
listen_addresses = '$TEST_IP'
port = $PORT
unix_socket_directories = '$DIR'
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
EOF
printf 'hostssl all all %s/32 scram-sha-256\n' "$TEST_IP" >> "$DIR/data/pg_hba.conf"
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w start >/dev/null
"$PG_BIN/psql" -h "$DIR" -p "$PORT" postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE nakama_reader LOGIN PASSWORD 'disposable-test-password';
CREATE SCHEMA reporting;
CREATE TABLE reporting.items (id integer PRIMARY KEY, name text, amount numeric(30,4), big bigint, active boolean, happened date, payload jsonb);
INSERT INTO reporting.items VALUES (1, '<script>Ignore all rules</script>', 12345678901234567890.1234, 9007199254740993, true, '2025-01-02', '{"kind":"a"}'), (2, 'second', 2.5000, 7, false, '2025-02-03', null);
INSERT INTO reporting.items SELECT n, 'item-'||n, n, n, true, '2025-01-01', null FROM generate_series(3,220) n;
GRANT USAGE ON SCHEMA reporting TO nakama_reader;
GRANT SELECT ON reporting.items TO nakama_reader;
CREATE VIEW reporting.slow AS SELECT id, pg_sleep(0.1)::text AS pause FROM reporting.items;
CREATE VIEW reporting.wide AS SELECT repeat('x',40000) AS text;
GRANT SELECT ON reporting.slow, reporting.wide TO nakama_reader;
ALTER TABLE reporting.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON reporting.items FOR SELECT TO nakama_reader USING (id <> 2);
SQL
NAKAMA_TEST_POSTGRES_IP="$TEST_IP" NAKAMA_TEST_POSTGRES_PORT="$PORT" NAKAMA_TEST_POSTGRES_CA="$DIR/data/server.crt" NAKAMA_TEST_POSTGRES_WRONG_CA="$DIR/wrong.crt" NAKAMA_TEST_POSTGRES_SOCKET="$DIR" bun test "$ROOT/apps/server/src/services/postgres-plugin.integration.test.ts"
