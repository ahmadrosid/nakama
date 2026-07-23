# First-time setup

This page walks through Nakama's setup wizard after the server is running.

## Open the dashboard

Where you open the dashboard depends on how you deployed:

| Deployment | URL |
|---|---|
| [Managed hosting](https://getnakama.cloud/) | Your instance URL (for example `acme.getnakama.cloud`) |
| [Docker](/docker) | `http://localhost:4310` |
| Local development | `http://localhost:3003` (web dev server proxies to the API) |

## Setup wizard

On a fresh install, Nakama guides you through:

1. **Create the first admin account** — this user becomes the platform admin
2. **Create the first organization** — the tenant boundary for profiles, members, and data
3. **Configure your model provider** — add an API key and pick models (see [Providers](/providers))
4. **Review default profiles** — Nakama seeds starter profiles; adjust tools and instructions as needed
5. **Invite members** (optional) — add teammates from org settings when you are ready

Settings are saved under the Nakama data root (`~/.nakama` by default, or `NAKAMA_CONFIG_DIR` when set).

## Send your first message

Open chat with the default profile and send a test message. If the provider is configured correctly, you should get a reply within a few seconds.

If chat fails, check **Settings → LLM providers** for a valid API key and confirm the profile has a model selected.

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
- [Multi-tenancy](/multi-tenancy) — orgs, members, and roles
- [Telegram](/telegram) — connect your first channel
