---
name: create-skill
description: Author or improve a reusable skill (SKILL.md) with skill_manage. Use when the user asks Super Bot to write, draft, design, review, or improve a skill or workflow.
include-body-on-match: true
---

Draft the skill in chat first. Call `skill_manage` only after the user confirms the draft.

## 1. Check the fit

A skill is a repeatable procedure the agent follows later. It is not a bot, a fact, or a preference.

- New bot or agent → `create-profile` skill, not a skill.
- User fact or preference → `update-profile-memory` skill.
- Tool or dashboard page → `create-plugin` skill.

Before you draft, read the skills catalog in your context. If a skill already covers the task, propose a `patch` to it instead of a new skill.

Ask follow-up questions only when the trigger, the steps, or the expected output is unclear.

## 2. Draft in chat

Post the full `SKILL.md`:

```markdown
---
name: skill-name
description: What the skill does. Use when <trigger phrases the user will say>.
include-body-on-match: true
---

Numbered steps the agent follows.
```

Rules for the draft:

- `name`: lowercase kebab-case, short, unique. It must not match a bundled skill name.
- `description`: one or two sentences. Say what it does and when to use it. Put the words the user will actually say in it, because matching uses this text.
- Body: imperative, numbered steps. Name the exact tools the steps use. Say what to do on failure and when to stop and ask the user.
- One task per skill. Split a broad skill into smaller skills.
- Keep it short. Put long reference text in a supporting file and point to it from the body.
- No secrets, API keys, tokens, or private user facts.

List any supporting files (path and content) under the draft.

## 3. Wait for explicit confirmation

Wait for a clear OK, for example "yes, create it". If the user edits the draft, revise it and wait again.

## 4. Write with skill_manage

- New skill: `create` with the full `content`.
- Small fix to an existing skill: `patch` with a unique `old_string` and `new_string`.
- Full rewrite: `edit` with the full `content`. The frontmatter `name` must not change.
- Supporting files: `write_file` with `name`, `path`, and `content`.

Never write `skills/*/…` with file tools. Bundled and global skills are read-only.

If the result has `staged: true`, the change waits for an org admin. Tell the user and give the `proposalId`. Do not submit the same proposal again.

## 5. Report

Tell the user:

- The skill name and whether it is live or staged
- The phrases that will trigger it
- How to run it now: `/skill <name>`
