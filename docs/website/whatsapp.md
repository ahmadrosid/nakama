# WhatsApp

Use WhatsApp when you want the same TinyClaw agent available from your phone in a direct chat.

The WhatsApp bridge talks to the same TinyClaw server as the web app and CLI. It is a chat channel, not a separate agent system.

## Good use cases

WhatsApp works well for:

- quick questions while away from your desk
- using one TinyClaw profile from phone and web
- simple direct-chat workflows for one linked number
- lightweight status checks and short back-and-forth conversations

## What WhatsApp can do

With WhatsApp enabled, users can:

- chat with a TinyClaw profile in a private WhatsApp chat
- switch org with commands
- start a new conversation or clear history
- stop an in-progress reply
- receive replies with simple WhatsApp-friendly formatting

## Reply formatting

Agents can still write normal Markdown-style replies, but TinyClaw simplifies them for WhatsApp.

In practice:

- code fences are flattened to plain text
- headings are converted to normal text
- bold and italics are reduced to WhatsApp-friendly formatting
- long replies are split into smaller chat bubbles

This keeps replies readable in WhatsApp without depending on web-style Markdown rendering.

## Setup

### 1. Enable WhatsApp in TinyClaw

1. Open **Integrations → WhatsApp** in the TinyClaw web app
2. Choose which profile should reply
3. Click **Enable WhatsApp**

### 2. Start the bridge

From the repo root:

```bash
bun run dev:whatsapp
```

If the TinyClaw server is not already running, start it too:

```bash
bun run dev:server
```

### 3. Link your WhatsApp account

TinyClaw supports two ways to link:

#### Option A: pairing code

1. In **Integrations → WhatsApp**, generate or copy the pairing code
2. Open WhatsApp on your phone
3. Go to **Settings → Linked Devices**
4. Choose **Link with phone number**
5. Enter the pairing code

#### Option B: QR code

1. Start the WhatsApp bridge
2. Wait for the QR code to appear in **Integrations → WhatsApp**
3. Open WhatsApp on your phone
4. Go to **Settings → Linked Devices**
5. Tap **Link a Device** and scan the QR code

After linking succeeds, TinyClaw shows the linked account and the bridge can receive messages.

## Chat behavior

WhatsApp currently works as a **private chat** channel.

- direct chats are supported
- group chats are not handled by the current bridge
- each linked WhatsApp chat keeps its own TinyClaw session

If you change the reply profile, new messages use that profile. Starting a new conversation with `/new` gives you a fresh session.

## Commands

Useful WhatsApp commands:

| Command | What it does |
| --- | --- |
| `/help` | Shows available WhatsApp commands |
| `/status` | Shows server and model status |
| `/org` | Lists or switches the active organization |
| `/clear` | Clears the current chat history |
| `/new` | Starts a fresh conversation |
| `/compact` | Compacts the current conversation history |
| `/stop` | Stops an in-progress reply |

## Troubleshooting

### WhatsApp is enabled but messages do not arrive

Check:

1. the TinyClaw server is running
2. the WhatsApp bridge is running with `bun run dev:whatsapp`
3. the WhatsApp account is linked
4. the linked number shown in **Integrations → WhatsApp** is the one you are messaging from

### Pairing code does not work

Check these first:

1. generate a fresh pairing code from **Integrations → WhatsApp**
2. open **Settings → Linked Devices → Link with phone number**
3. paste the latest code exactly as shown

If a code was already used or expired, generate a new one.

### QR linking is stuck

If QR linking does not finish:

1. use **Reconnect with QR** in **Integrations → WhatsApp**
2. wait for a fresh QR code
3. scan it again from WhatsApp

### The wrong bot is answering

Open **Integrations → WhatsApp** and check the **Reply as** profile. That is the profile the bridge uses for new messages.

## Next steps

- [Getting Started](/getting-started)
- [Profiles](/profiles)
- [Multi-tenancy](/multi-tenancy)
