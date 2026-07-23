# First-time setup

This page walks through Nakama's setup wizard after the server is running.

## Open the dashboard

Where you open the dashboard depends on how you deployed:

| Deployment | URL |
|---|---|
| [Managed hosting](https://getnakama.cloud/) | Your instance URL (for example `acme.getnakama.cloud`) |
| [Docker](/docker) | `http://localhost:4310` |
| Local development | `http://localhost:3003` (web dev server proxies to the API) |

On a fresh install, Nakama redirects you to the setup wizard automatically.

## Step 1: Admin account

Create the first platform admin. This account can manage organizations, profiles, providers, and system settings.

![Create your admin account](/screenshots/setup-step-account.png)

Fill in your name, email, and password, then click **Continue**.

## Step 2: Organization

Every workspace lives inside an organization. Name yours and choose a slug for URLs and API context.

![Create your organization](/screenshots/setup-step-organization.png)

The slug must use lowercase letters, numbers, and hyphens only. Click **Create Organization** to save the admin account and org together.

## Step 3: Provider

Add your first LLM provider and pick a default model. You can add more providers later from **Settings**.

![Configure your LLM provider](/screenshots/setup-step-provider.png)

See [Providers](/providers) for supported backends and feature notes (web search, audio transcription, etc.).

## Step 4: About you (optional)

The wizard can ask for optional context about you and how you prefer agents to respond. Skip this step if you want to start chatting immediately.

## Send your first message

After the provider step, Nakama opens chat with the default profile. Send a test message — you should get a reply within a few seconds.

If chat fails, reopen **Settings → LLM providers** and confirm the API key and profile model selection.

## What to configure next

Most operators focus on four areas after setup:

- **Organization** — the tenant boundary
- **Members** — who can access that org
- **Profiles** — the bots people talk to
- **Tools and skills** — what each profile is allowed to do

See [Overview](/overview) for the mental model and [Profiles](/profiles) for soul files, memory, and tool assignment.

## Next steps

- [Providers](/providers) — supported LLM backends and API keys
- [Profiles](/profiles) — define each bot's behavior
- [CLI](/cli) — chat from the terminal
- [Multi-tenancy](/multi-tenancy) — orgs, members, and roles
- [Telegram](/telegram) — connect your first channel

## Refreshing screenshots

Docs screenshots are captured with [agent-browser](https://github.com/vercel-labs/agent-browser) against a fresh local install:

```bash
./docs/website/scripts/capture-setup-screenshots.sh
```

Requires `agent-browser` on your PATH and a free port (`4312` by default).
