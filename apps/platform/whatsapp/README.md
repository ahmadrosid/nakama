# WhatsApp Bridge

Run the WhatsApp bridge with:

```sh
bun run dev:whatsapp
```

Setup flow:

1. Start the server with `bun run dev:server`
2. Open the web dashboard and go to `Integrations -> WhatsApp`
3. Save your phone number and profile
4. Copy the pairing code
5. In WhatsApp, open `Settings -> Linked Devices -> Link with phone number`
6. Enter the pairing code

Notes:

- Auth state is stored in `~/.nakama/whatsapp/auth/`
- Chat session mappings are stored in `~/.nakama/whatsapp/chat-sessions.json`
- Restart the bridge after changing the saved phone number
- Groups reply only to a mention of the linked number, a reply to a Nakama message, or a `/command`. Pair in a private chat, or mention the bot and send a pairing code in the group.

Optional env (case-sensitive; full contract in repo-root `AGENTS.md` → Platform worker env): `WHATSAPP_PHONE_NUMBER`, `nakama_WHATSAPP_PROFILE_ID`, `nakama_SERVER_URL`.
