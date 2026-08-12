# Nakama — Customer Pitch Deck (ASD-STE100)

**Audience:** Team leads and agencies  
**Goal:** Open the public demo, or install with Docker  
**Length:** About 11 slides (8 to 12 minutes)

Copy follows ASD-STE100 practice where possible: short sentences, active voice, approved simple wording, vertical lists, noun clusters of three words or fewer, and no slang or metaphor. Product names (Nakama, ChatGPT, Docker, Telegram, and others) are technical names.

---

## Slide 1 — Title

**Nakama**

Stop shared work in private ChatGPT chats. Run one agent workspace for your team.

Nakama gives each team or each client agents, memory, and channels on one platform.

`getnakama.cloud` · `demo.getnakama.cloud` · Open source

---

## Slide 2 — The problem

**Teams need more than ChatGPT. Agent tools for one operator do not scale.**

1. **Many private chats** — Each person uses a private ChatGPT chat. The team does not share agents, memory, or control.
2. **Tools for one operator** — Tools such as OpenClaw and Hermes work on one machine for one person.
3. **Teams and agencies need more** — They need many users, many clients, channels, and roles.

---

## Slide 3 — Who can use Nakama

**Nakama serves two types of buyers.**

| Buyer | Need |
| --- | --- |
| **Team lead** (operations, support, founder) | Shared agents on the web, Telegram, and WhatsApp. Not only personal ChatGPT. |
| **Agency or freelancer** | One platform for many client organizations. Isolated agents, memory, and channels for each client. |

---

## Slide 4 — Solution

**Nakama is a multi-tenant platform for AI agents.**

You can install Nakama on your servers, as with WordPress. You can also use managed hosting.

- One server can serve many organizations.
- Agents have identity (soul), memory, skills, and tools.
- Channels connect to the tools that teams already use.
- Roles include admin, member, and viewer.

---

## Slide 5 — Feature 1: Organizations and roles

**Nakama is multi-tenant by design.**

- Organizations are tenants.
- You can send invites and assign roles: admin, member, viewer.
- Profiles, sessions, automations, tools, and usage stay isolated by organization.
- Agencies: One installation can serve many client workspaces.

---

## Slide 6 — Feature 2: Souls and memory

**Agents keep context across sessions. Agents do not use only temporary chats.**

Each profile has these soul files:

| File | Role |
| --- | --- |
| `SOUL.md` | Identity |
| `STYLE.md` | Voice |
| `INSTRUCTIONS.md` | Operating rules |
| `MEMORY.md` | Facts across sessions |

Team knowledge increases over time. Client organizations stay separate.

---

## Slide 7 — Feature 3: Channels

**Use the channels that your team already uses.**

- Web dashboard and CLI
- Telegram, WhatsApp, and Discord
- The same agent and the same soul operate across channels.
- Automations and tasks do recurring work.

---

## Slide 8 — Work examples

**Nakama agents can do these tasks:**

Connect external apps with Composio. Assign skills and tools to each profile.

1. **Documents** — Connect Google Drive, Docs, and Sheets. Read and change documents.
2. **Calendar** — Create, change, and review calendar events.
3. **Email** — Read email. Write and send replies.
4. **Short video** — Configure an agent to edit short videos.
5. **Coding agent** — Start Codex, Claude Code, OpenCode, or Cursor Agent. Write and change code, including Nakama itself.
6. **Automations** — Schedule agent work on a timer for recurring tasks.

---

## Slide 9 — Comparison

**Nakama is not only a chatbot. Nakama is not a tool for one operator.**

| Function | ChatGPT / Claude Team | OpenClaw-style | **Nakama** |
| --- | --- | --- | --- |
| Shared team agents | Limited | One operator | **Yes** |
| Multi-tenant orgs | No | No | **Yes** |
| Channels | Limited | Often available | **Yes** |
| Durable memory | Chat history | One machine | **Org and profile** |
| Deployment | SaaS only | One local system | **Docker or Cloud** |

Nakama is a platform for team agents.

---

## Slide 10 — Evidence

**Nakama is open source. A public demo is available.**

- **200** GitHub stars
- **22** forks
- **7** contributors
- Public demo: [demo.getnakama.cloud](https://demo.getnakama.cloud)
- Documentation: [ahmadrosid.github.io/nakama](https://ahmadrosid.github.io/nakama/)
- Managed hosting: [getnakama.cloud](https://getnakama.cloud/)

Update the star and fork counts before each talk.

---

## Slide 11 — Start a test

**Open the public demo. Install Nakama with Docker when you are ready.**

**1. Public demo**  
[demo.getnakama.cloud](https://demo.getnakama.cloud)  
`demo@getnakama.cloud` / `demo1234`

**2. Install with Docker**

```bash
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama \
  ghcr.io/ahmadrosid/nakama:latest
```

Open the dashboard: `http://localhost:4310`

**3. Managed hosting**  
If you do not want to install Nakama, use [getnakama.cloud](https://getnakama.cloud/).

---

## STE changes from the earlier draft

| Before (non-STE) | After (STE practice) |
| --- | --- |
| Stop pasting into ChatGPT… | Stop shared work in private ChatGPT chats. Run one agent workspace for your team. |
| ChatGPT sprawl / shine / blast radius | Plain description; no metaphor |
| Same product. Different blast radius. | Nakama serves two types of buyers. |
| Context that compounds | Team knowledge increases over time. |
| Meet teams where they work | Use the channels that your team already uses. |
| Not a chatbot. Not a solo bot. | Full sentences; specific contrast |
| Try it now / Prefer managed? | Start a test / Managed hosting |
| Weak / Solo / DIY one box | Limited / One operator / One local system |

---

## Locked brief (from interview)

| Decision | Choice |
| --- | --- |
| Deck type | Customer / buyer |
| ICP | Team leads and agencies (team narrative is primary) |
| Pain | Many private ChatGPT chats + tools for one operator do not scale |
| Promise | One agent workspace; agents, memory, and channels per team or client |
| Features | Organizations and roles · Souls and memory · Channels · Work examples |
| Compare with | ChatGPT / Claude Team and OpenClaw-style tools |
| Call to action | Public demo and Docker install |
| Evidence | GitHub stars, forks, and contributors |
