# @nakama/telegram-manager

Host a shared Telegram bot manager with the public code used by Nakama Cloud.
The package owns pairing, Telegram calls, webhook verification, and PostgreSQL
queries. It has no dependency on Nakama's server or cloud application.

## Install from GitHub

With pnpm 10, replace `<commit>` with the full commit SHA you reviewed:

```bash
pnpm add '@nakama/telegram-manager@github:ahmadrosid/nakama#<commit>&path:/packages/telegram-manager'
```

Import it as `@nakama/telegram-manager`. No registry account is needed. The Git
package includes compiled JavaScript and declarations for Node 20+, so installing
it does not run build scripts or require Bun, Yarn, or TypeScript on the host.
npm CLI does not support this Git subfolder syntax; npm users can clone the repo
and install this folder, or use a tarball created with `npm pack` inside it.

## Host the gateway

Apply [`schema.sql`](./schema.sql) through your application's migrations. Mount
two POST routes using standard Request/Response objects:

```ts
import postgres from "postgres";
import { handleTelegramPairing, handleTelegramWebhook } from "@nakama/telegram-manager";

const options = {
  sql: postgres(process.env.DATABASE_URL!),
  managerToken: process.env.NAKAMA_TELEGRAM_MANAGER_BOT_TOKEN,
  webhookSecret: process.env.TELEGRAM_MANAGER_WEBHOOK_SECRET,
};

// POST /api/telegram/pairing
const pairing = (request: Request) => handleTelegramPairing(request, options);
// POST /api/telegram/webhook
const webhook = (request: Request) => handleTelegramWebhook(request, options);
```

Create a dedicated bot in BotFather and enable its permission to manage bots.
Generate a webhook secret with `openssl rand -hex 32`. Deploy over HTTPS, then
register the webhook (substitute your own host):

```bash
curl --fail-with-body --silent --show-error \
  "https://api.telegram.org/bot${NAKAMA_TELEGRAM_MANAGER_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://your-host.example/api/telegram/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_MANAGER_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","managed_bot"]' \
  --data-urlencode 'max_connections=1'
```

Do not poll this manager from another process. Set request body limits and per-IP
rate limits at your ingress. The package caps active pairings at 1,000; this bounds
stored sessions but is not a per-IP abuse limit.

## Pairing API

POST JSON to `/api/telegram/pairing`:

| Action | Request | Result |
| --- | --- | --- |
| `start` | `{ "action": "start" }` | `pairingId`, `secret`, `deepLink`, `qrPayload`, `suggestedUsername`, `expiresAt` |
| `status` | `{ "action": "status", "pairingId": "..." }` | `status`, `botUsername`, `ownerUserId` |
| `token` | `{ "action": "token", "pairingId": "..." }` | Ready status plus `token` |
| `cancel` | `{ "action": "cancel", "pairingId": "..." }` | Deletes the pairing |

All actions except `start` require `Authorization: Bearer <secret>`. Keep this
secret on the requesting server, never in the QR or browser. The user opens the
QR in Telegram, presses Start, then creates their bot with the supplied button.
Keep the suggested username: both it and the verified Telegram user must match.
Renaming during creation requires starting again.

After saving the bot token locally, call `cancel`. Token retrieval can be retried
if the local save fails, until cancellation or the 10-minute expiry. Responses
use `Cache-Control: no-store`. Missing/expired sessions return 404; unready token
requests return 409; capacity exhaustion returns 429; Telegram errors return 502.

## Trust and data handling

- **The manager operator can retrieve managed bot tokens** and control those bots,
  even after a pairing ends. Deleting a pairing does not revoke the manager's
  Telegram permissions. Public source is inspectable; it does not prove what
  a particular hosted operator runs.
- The gateway stores a hashed pairing secret, suggested username, Telegram user
  and bot IDs, bot username, and expiry. It never stores managed bot tokens.
  Expired records are inaccessible and deleted on the next pairing creation.
- Nakama saves the token on its own server. Normal conversations go directly
  between that server and Telegram, without passing through this gateway.
- Nakama defaults to `https://getnakama.cloud`. Set
  `NAKAMA_TELEGRAM_MANAGER_URL=https://your-host.example` on the Nakama server to
  choose another gateway. `NAKAMA_TELEGRAM_MANAGER_BOT_TOKEN` runs a local manager
  instead. Manual BotFather token entry avoids granting a shared manager access.

## Verify

Use a disposable database; the tests clear its pairing table:

```bash
psql "$TEST_TELEGRAM_DATABASE_URL" -f schema.sql
TEST_TELEGRAM_DATABASE_URL=postgresql://... bun test
npm run build
git diff --exit-code -- dist
npm pack --dry-run
```

The source, schema, and tests ship with the package for inspection.
