# Move API keys and the email password out of `config.ini`

## Decision

Keep secret entry in Settings. Store those secrets in the existing SQLite database, encrypted at rest. Let deployment environment variables override stored values. A Settings change takes effect for new work without a restart. An environment change takes effect after a process restart. Never use `config.ini` as a secret fallback.

This plan covers provider API keys, web-search API keys, organization tool API keys, the Composio API key, and the email password. Keep provider choices, model settings, endpoints, and other non-secret settings in `config.ini`.

| Integration | Current file field | Environment override |
| --- | --- | --- |
| Provider instance | `~/.nakama/config.ini`, `[provider.<id>].api_key` | Existing provider variable, or `NAKAMA_PROVIDER_API_KEY_<ID>` for one instance |
| Web search | `~/.nakama/config.ini`, `[web_search].api_key` | `EXA_API_KEY` or `FIRECRAWL_API_KEY`, selected by provider |
| Organization tool | `~/.nakama/config.ini`, `[tool-key.<encoded org/tool IDs>].api_key` | `NAKAMA_TOOL_API_KEY_<ID>` for that organization and tool |
| Email | `~/.nakama/config.ini`, `[email].password` | `NAKAMA_EMAIL_PASSWORD` for IMAP and SMTP |
| Composio | `~/.nakama/composio/config.ini`, `api_key` | Existing `COMPOSIO_API_KEY` |

For providers, `<ID>` is the provider UUID without hyphens, in uppercase. The instance variable takes priority over the provider-type variable. Add `DEEPSEEK_API_KEY` to the provider variable map. For tools, `<ID>` is the uppercase SHA-256 hex digest of `orgId + "\0" + toolId`. Settings shows the exact variable name without showing the value.

Other credentials remain in `config.ini`: OAuth tokens, channel tokens, the MFA encryption key, the WhatsApp outbound token, and the error-tracking DSN. The compliance owner must confirm whether those fields are also in scope. This plan does not claim that *all* secrets leave `config.ini`.

## Security boundary

The database encryption protects copied database files and backups when the master key is kept separately. It does not isolate secrets from trusted server code. Nakama's host `bash` runs with the server's operating-system rights. Filtering child environment variables alone does not stop it from reading accessible secret files or, on some hosts, the server process environment. Treat host `bash`, coding agents, custom host code, and plugins as trusted with those rights. For a deployment that must protect secrets from agent-run code, use a separate sandbox or process identity with no access to the database, secret mounts, key store, or server process. Disable host `bash` for untrusted profiles until that boundary exists. The current microsandbox does not support coding-agent runs, so those runs need a separate boundary or an explicit compliance exception.

## Storage and resolution

1. Add one secret table through the existing database adapter and migration path. Store secret scope, identity, selected source, encrypted value, nonce, authentication tag, and key version. Use the existing organization ID for tool secrets. Keep global integrations separate from organization data.
2. Encrypt each value with AES-256-GCM and a fresh random nonce. Bind the ciphertext to its scope and identity with authenticated data. Keep the encryption key outside the database, `config.ini`, and exports.
3. Require a base64-encoded, randomly generated 32-byte `NAKAMA_SECRETS_KEY` in server deployments. Reject weak, malformed, or missing keys before migration or Settings writes. The desktop launcher generates one key once in the operating-system credential store and passes it to the server process. Its current `NAKAMA_*` environment filter needs an explicit bridge. Filter the key from all agent-run child processes. Fail closed when existing ciphertext cannot be decrypted; never replace its key automatically.
4. Resolve each secret from its environment override when present. Use the existing direct-variable and `_FILE` rules where supported; a direct value wins over its file path. Record `environment` as the selected source. Otherwise use the encrypted value only when `settings` is the selected source. If an environment value later disappears, report the secret as missing until an admin selects Settings. Never read a legacy file value after migration. Keep local Ollama and other providers that support no key usable without one.
5. Keep the resolver at the server boundary. Pass resolved values into existing core paths instead of making `packages/core` depend on `packages/db`. Replace direct `loadEmailConfig()` calls in email delivery and automation checks, and direct `loadWebSearchConfig()` calls in tool resolution. Apply the resolver to setup checks, provider creation, model discovery, validation, chat, web search, Composio, tool execution, and email send/receive. Remove `apiKey` from persisted provider objects after migration so a later save cannot copy it into a file.
6. Limit child environments. Remove the master key, managed secrets, and secret-file path variables from `bash`, coding-agent, and other agent-run process environments. Pass only a selected provider key when that tool explicitly needs it. Pass only the relevant organization tool key to its subprocess. This filtering reduces accidental disclosure; the security boundary above still applies.
7. Stop writing provider keys into coding-agent harness files. `coding-agent-harness-config-files.ts` currently puts them in temporary TOML and JSON files; a crash can leave those files behind. Use a supported environment reference or another in-memory handoff. Do not enable a harness mode until it can receive the key without a plaintext config file.

## Settings behavior

1. An authorized admin pastes a new key or email password in Settings. Make secret changes a separate API operation from file-backed settings changes, so a failed file write cannot leave an ambiguous combined save. Create the provider or tool ID first; leave it unconfigured if its secret save fails. The API validates, encrypts, and commits the secret. It never returns the value. GET responses show only `configured` and `source` (`settings`, `environment`, or `missing`).
2. After commit, increment a secret version in SQLite. Each server process checks that version before new work and rebuilds affected provider sessions or cached integration clients when it changes. New requests use the new value without a restart, including requests on other processes. In-flight requests can finish with the old value. A failed save leaves the prior value active.
3. If an environment override exists, Settings shows `Managed by environment`. The secret field is read-only. The operator changes the deployment secret and restarts the process. The UI must not report a stored value as the active value when an override exists.
4. For a new provider or tool, create its stable ID before showing an instance-specific environment variable. Keep Settings paste available. A pending tool approval keeps its staged secret encrypted and moves it to the final tool identity when approved. Delete staged secrets on rejection or expiry.
5. Allow an admin to clear a Settings-managed value. When an environment override disappears, keep the integration unavailable until an admin explicitly selects any stored Settings value.
6. Delete stored secrets when an admin deletes a provider, tool, or organization. Remove the old vendor key when web search changes vendor unless an admin explicitly keeps it. Deleting a stored secret does not delete an environment override; show that source clearly.

## Migration and rollout

1. Require the master key before an upgrade that contains file secrets. Give operators a pre-upgrade key setup step; existing Docker launches without that key cannot migrate automatically. Start the database before `ensureProviderConfigured()`. Run migration before API, workers, or exports can use old files. Stop old server processes during the cutover so they cannot write plaintext back.
2. Read each legacy file secret once. When no environment override exists, encrypt and store it. Verify that it decrypts. When an override exists, mark the integration as environment-managed and remove the old file value; do not keep an unseen stored fallback. Preserve pending tool setup secrets in encrypted storage.
3. After successful storage or verified override, remove the migrated fields with the existing private, atomic config writer. Make `buildConfigIniLines` omit every `api_key` field and `[email].password`, including values copied from an old parsed file. Remove Composio's key-only config file. Make migration repeatable and stop startup if any step fails.
4. Update setup, web Settings, CLI, request contracts, and configured-state checks. Reject nonempty secret fields sent to old non-secret save endpoints; do not silently claim that a key was saved. Keep password fields only on dedicated secret operations. Never echo a value in responses, logs, traces, or errors. Apply the existing admin and organization access rules to writes, reads of status, and deletion.
5. Update export and restore together. Fresh exports must exclude plaintext file secrets and the master key. Full backups can include encrypted database values, but restore needs the matching key supplied separately. For a legacy archive, migrate its file secrets into the staged database, verify decryption, then scrub the staged files before promotion. For an encrypted archive, verify its key and every secret before promotion. Refuse a restore if either check fails; keep the live data intact. Org/profile exports omit secret values; imported integrations require a new key or an environment override.
6. Document Docker, Kubernetes, and desktop key setup. All server processes sharing a database need the same master key and environment overrides. Check this at deployment and report a missing override instead of treating one process as configured. Back up the master key separately. Desktop needs an admin-only, operating-system-unlock recovery-key export and import path for moving a backup to another machine; never put the key in the data archive. For rotation, keep old and new keys available until every value is re-encrypted and verified; retain old keys while backups still need them.
7. After stopping old servers, remove abandoned `nakama-codex-config-`, `nakama-opencode-config-`, and `nakama-pi-config-` temporary directories from those servers' temp locations. Check active config files and a fresh export for old plaintext. Treat older backups and snapshots as exposed copies under the retention policy. Rotate affected provider keys when policy requires it. Roll back only to a build that cannot write file secrets.

## Release checks

- A legacy file key migrates once, works after restart, and leaves no `api_key` or `[email].password` in any active `config.ini`. Unrelated settings saves do not restore those fields.
- Settings save, rotation, and deletion change new requests without restart. In-flight work behaves as documented. A failed save keeps the previous key.
- An old client that submits a key to a non-secret settings endpoint gets a clear error and does not write it to `config.ini`.
- A Settings change reaches a second running server process before its next use. Two processes with different environment overrides cannot silently show one shared configured state.
- Environment overrides win, show `Managed by environment`, and need a restart when changed. A missing override never causes an unseen stored key to become active.
- Two provider instances can use different keys. An organization cannot read or change another organization's tool secret. Pending approval retains its key without plaintext files.
- Deleting a provider, tool, organization, or rejected tool setup removes its stored key. An environment override remains visible until its operator removes it.
- Missing or wrong `NAKAMA_SECRETS_KEY` blocks access to encrypted secrets. Multi-process instances use the same key. Master key and managed secrets are absent from agent-run child environments.
- A deployment that claims isolation from agent-run code uses a separate sandbox or process identity. Host `bash` and coding-agent runs cannot read the server key, secret files, or database through host access.
- Existing Docker data migrates only after an operator supplies a valid key. Desktop setup persists a generated key across relaunches. A bad key never causes a new empty store.
- A desktop full backup restores on another machine with its separately saved recovery key and fails clearly without it.
- Model discovery, provider validation, web search, Composio, tool execution, and email send/receive use the resolved value. Logs and API responses never contain it.
- Keyless local providers still work. `_FILE` support follows the documented precedence, and child processes cannot read managed secret files through inherited path variables.
- Coding-agent harness setup leaves no plaintext provider key in temporary files, including after a crash.
- Fresh exports and legacy restores cannot revive plaintext file secrets. Backup restore succeeds with the matching master key and fails without it or with a corrupt secret. A failed restore leaves live data intact.

## Compliance decision

Confirm that encrypted database storage, with a separate managed encryption key, meets the stated control. If the control requires **environment-only** secret storage, disable Settings paste and use the environment-only flow instead. Also confirm whether the other credentials listed above must leave `config.ini`.
