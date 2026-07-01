# How Multi-tenancy Works

TinyClaw is built for running more than one team or customer on the same deployment.

The main rule is simple:

- One **organization** is one tenant boundary

That organization keeps its own:

- Profiles
- Sessions
- Members
- Tools
- Skills
- MCP servers
- Usage data

## Why this matters

Multi-tenancy lets you run one TinyClaw server without mixing teams together.

For example:

- Agency A should not see Agency B's profiles
- Internal HR bots should not share memory with Sales bots
- A contractor can be added to one org without seeing the others

## Actors and roles

| Actor | Scope | Capabilities |
|---|---|---|
| Platform admin | Whole deployment | Create orgs and manage shared system-level bot resources |
| Org admin | One organization | Invite members and manage roles |
| Org member | One organization | Chat with profiles and use the workspace |
| Org viewer | One organization | Read chat history only |

## Practical mental model

When deciding permissions, think of it like this:

- **Platform admin** manages the deployment itself
- **Org admin** manages who is inside one organization
- **Member** uses the bots
- **Viewer** can look, but not act

## First-time setup

When you install TinyClaw for the first time:

1. You create the first admin user
2. TinyClaw creates the first organization
3. That admin can invite more people
4. More organizations can be created later if needed

## Common examples

Use separate organizations when you want clear separation between:

- Different customers
- Different internal teams
- Different environments
- Different privacy boundaries

If one team needs different bots but should still share users and data boundaries, use multiple **profiles** inside one organization instead.

## Important limitation

Org admins manage members, but profile and tool provisioning is still a platform-admin responsibility.

So the split is:

- Org admin manages people
- Platform admin manages the bot system

## Next steps

- [Profiles](/profiles) — how to model bots inside an organization
- [Builtin tools](/builtin-tools) — how profile capabilities are controlled
- [Getting Started](/getting-started) — setup flow from zero
