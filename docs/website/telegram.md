# Telegram

TinyClaw can run as a Telegram bot so you can chat with the same agent from your phone, desktop Telegram, or a shared group.

The mental model is simple:

- Telegram is a **channel** for TinyClaw
- The bridge talks to the same TinyClaw server as the web app
- Pairing links a real Telegram user to your TinyClaw access

## What Telegram supports

With Telegram enabled, users can:

- chat with a TinyClaw profile in a private chat
- use the bot in Telegram groups
- receive outbound webhook notifications in a group or topic
- switch org and profile with commands
- send text, photos, voice notes, and supported documents
- receive Markdown-style rich replies when Telegram accepts the formatting

## Step 1: Create a bot with BotFather

Every Telegram setup starts with a bot token from `@BotFather`.

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Choose a display name
4. Choose a username that ends with `bot`
5. Copy the bot token

Keep the token secret. Anyone with the token can control your Telegram bot.

## Step 2: Save Telegram settings in TinyClaw

Open **Integrations → Telegram** in the TinyClaw web app, then:

1. Paste the bot token
2. Choose the default TinyClaw profile for Telegram replies
3. Save

When you save for the first time, TinyClaw can generate a pairing code for linking your Telegram account.

## Step 3: Enable audio transcription for voice chat

Telegram voice notes and audio files are turned into text before they are sent to the agent.

To enable that:

1. Open **Settings** in the TinyClaw web app
2. Add an **OpenAI** provider in **LLM providers** if you have not added one yet
3. In **Audio transcription model**, choose an OpenAI model such as Whisper
4. Wait for the `Saved` confirmation

If no OpenAI provider is connected, the audio transcription setting stays unavailable.
Without this setting, text chat still works, but Telegram audio messages will not be transcribed for the agent.

## Step 4: Pair your Telegram account

Pairing is required so random Telegram users cannot talk to your internal TinyClaw bot.

1. Copy the pairing code from **Integrations → Telegram**
2. Start a private chat with your bot
3. Send the pairing code as a normal text message

After a successful match, that Telegram user is linked and the pairing code is cleared.

### Why pairing exists

The bot token only connects TinyClaw to Telegram.

Pairing connects **your Telegram user account** to TinyClaw permissions.

That means TinyClaw can:

- identify which Telegram user is talking
- allow private chat safely
- apply the right org and profile access

## Step 5: Start the Telegram bridge

For local development, start it from the repo root:

```bash
bun run dev:telegram
```

The bridge uses long polling and forwards Telegram messages to your TinyClaw server.

If the TinyClaw server is not already running, the bridge will try to start it.

For production, start the Telegram bridge worker from the **Integrations** page in the TinyClaw web app instead of using the dev command.

## Optional: Direct allowlist instead of pairing

TinyClaw also supports allowlisting Telegram user IDs directly.

This is useful when you want to pre-authorize specific users without the one-time pairing flow.

To add users from the dashboard:

1. Open **Integrations → Telegram**
2. In **Allowed users**, click **Manage**
3. Paste a numeric Telegram user ID and click **Add**

To paste raw Telegram update JSON instead:

1. Open **Integrations → Telegram**
2. In **Allowed users**, click **Manage**
3. Click **Import JSON**
4. Paste the raw Telegram update JSON
5. Click **Add user**

Use the Telegram user's `from.id`, not their `@username`.
When you paste raw JSON, TinyClaw reads `message.from.id` and shows the username when it is present.

For example, in this Telegram update payload:

```json
{
  "from": {
    "id": 213193924,
    "username": "ahmadrosid"
  }
}
```

The allowed user ID is:

```text
213193924
```

You can also configure allowed users through `TELEGRAM_ALLOWED_USER_IDS` for environment-based deployments.

## Private chat behavior

Private chat is the simplest mode.

Once paired or allowlisted:

- normal messages go to the TinyClaw agent
- the bot keeps a Telegram chat session
- Telegram commands work immediately

If an unlinked user opens the bot, TinyClaw asks for the pairing code instead of sending the message to the agent.

## Group chat behavior

TinyClaw supports Telegram groups, but it is intentionally conservative about when it replies.

In a group, the bot responds only when the message is:

- a slash command like `/status`
- a reply to one of the bot's messages
- a direct mention like `@your_bot_name hello`

This keeps group chats usable without making the bot noisy.

### Group topics and profiles

In Telegram supergroup topics, each topic can use its own TinyClaw profile.

- `/profile` inside a topic changes only that topic
- new topics use the default Telegram profile until you switch them
- `/profile` in the main group chat changes the group-level profile
- `/org` stays group-level, so switch org first if a topic needs a profile from another org

## Outbound notifications to Telegram

TinyClaw can also send simple text notifications into Telegram.

This is separate from the normal chat bridge. Instead of waiting for a Telegram user to message the bot first, another app can call a TinyClaw webhook and TinyClaw will post the message into a configured Telegram chat.

This is useful for things like:

- new payment notifications
- failed job alerts
- deploy finished messages
- support or sales event notifications

### How it works

1. Open **Integrations**
2. In **Notification destinations**, create a new destination
3. Choose a name
4. Paste the Telegram topic link, such as `https://t.me/c/3734526664/147`
6. Save and copy the generated webhook URL and API key

Each destination belongs to one org and points to one Telegram target.
TinyClaw extracts the Telegram Chat ID and Topic ID from the link and sends the message directly into that topic thread.

### Webhook payload

TinyClaw keeps the webhook contract intentionally small.

Send a `POST` request with JSON like this:

```json
{
  "title": "Payment received",
  "body": "Order #INV-1042 paid by Acme Co.",
  "level": "success"
}
```

`body` is required.
`title` is optional.
`level` is optional and can be `info`, `success`, `warning`, or `error`.

TinyClaw formats that into a short Telegram text message and sends it to the configured chat or topic.

### Design note

In v1, TinyClaw does not accept arbitrary templating or custom Telegram payloads from external apps.

That is intentional:

- the webhook stays stable and easy to validate
- external apps only need to send simple notification text
- the destination model can later support Slack or Discord with the same webhook shape

## Step 6: Configure Telegram privacy mode for groups

Telegram bots start with **Group Privacy** enabled. This is the most common reason a bot seems fine in private chat but not in groups.

If you want mention-based group usage to work reliably:

1. Open `@BotFather`
2. Open your bot settings
3. Disable **Group Privacy**
4. Remove the bot from the Telegram group
5. Add it back again

That re-add step matters because Telegram may keep the old delivery behavior for bots already in the group.

## Telegram commands

These commands are available in Telegram:

| Command | What it does |
| --- | --- |
| `/start` | Welcome and help |
| `/help` | Show command help |
| `/stop` | Stop the current in-progress reply |
| `/clear` | Clear chat history |
| `/compact` | Compact conversation history |
| `/new` | Start a new conversation |
| `/org` | Choose or switch organization |
| `/profile` | Choose or switch profile |
| `/status` | Show server and model status |

## Supported message types

Telegram can send more than plain text into TinyClaw.

Supported inputs include:

- text messages
- photos
- voice notes and audio messages
- supported documents such as `pdf`, `docx`, `txt`, and `csv`

Small supported documents are downloaded and forwarded into the TinyClaw chat flow. Voice notes and audio messages are first transcribed with the configured OpenAI audio transcription model. Unsupported media gets a friendly rejection message instead of silently failing.

## Rich Markdown replies

Agents can reply in normal Markdown-style text. TinyClaw converts a safe subset into Telegram rich formatting.

Supported formatting includes:

- `**bold**`
- `*italic*`
- `__underline__`
- inline code
- fenced code blocks
- headings
- simple links

If Telegram rejects the rich rendering, TinyClaw falls back to plain text.

## Configuration notes

TinyClaw stores Telegram bridge settings under its local config directory.

Important values include:

- bot token
- default Telegram profile
- pairing code
- paired user IDs
- allowed user IDs from the dashboard allowlist

Environment-based setup is also supported. The main env var is:

```text
TELEGRAM_BOT_TOKEN
```

TinyClaw also supports:

```text
TELEGRAM_ALLOWED_USER_IDS
TINYCLAW_TELEGRAM_PROFILE_ID
```

## Notification destinations for groups and topics

From **Integrations → Notifications**, TinyClaw can create Telegram webhook destinations for a group or a forum topic.

If you already have a topic share link such as:

```text
https://t.me/c/3734526664/147
```

you can derive the form values directly:

- `Telegram chat ID`: prefix the number after `/c/` with `-100` → `-1003734526664`
- `Telegram topic ID`: use the last path segment → `147`

This matches what Telegram Bot API returns in:

- `message.chat.id`
- `message.message_thread_id`

If you prefer the API method, send a fresh message in the target topic and call:

```text
https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
```

Then copy `message.chat.id` and `message.message_thread_id` from the matching update.

## Troubleshooting

### The bot does not answer at all

Check these first:

1. The bot token is saved correctly
2. `bun run dev:telegram` is running
3. The TinyClaw server is running
4. The Telegram user is paired or allowlisted

### Private chat works but group chat does not

Usually one of these is true:

- Group Privacy is still enabled
- the bot was added before Group Privacy was changed
- the bot was not removed and re-added
- the message was not a command, reply, or direct mention

### Mentions do not work in groups

Check these:

1. Disable **Group Privacy** in `@BotFather`
2. Remove the bot from the group and add it again
3. Make sure only one Telegram bridge worker is running

### Telegram says the chat is not linked

This usually means:

- the user never sent the pairing code
- the pairing code expired or was replaced
- the message was sent in a group instead of a private chat

Generate a new pairing code from **Integrations → Telegram** and send it to the bot in a private chat.

## Next steps

- [Getting Started](/getting-started)
- [Profiles](/profiles)
- [WhatsApp](/whatsapp)
