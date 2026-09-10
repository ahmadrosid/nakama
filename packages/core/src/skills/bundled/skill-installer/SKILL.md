---
name: skill-installer
description: Find, list, and install reusable skills from public GitHub repositories. Use when the user asks to install a skill, add a skill from GitHub, browse available skills, or install a named curated skill.
include-body-on-match: true
---

# Skill Installer

Install skills for the current Nakama profile using `skill_manage`. Do not install into Codex directories or run an external installer with bash.

## Find a skill

- If the user provides a GitHub skill directory or SKILL.md URL, use that source.
- If they provide only a skill name, look it up in the public `openai/skills` repository under `skills/.curated`. Use `skills/.experimental` only when they ask for experimental skills.
- If they ask what is available, use an available web search or fetch tool to inspect the repository catalog. List names and link the source; ask which skill they want. Do not install every result.
- If discovery tools are unavailable or the catalog cannot be retrieved, explain the limitation and ask for a public GitHub skill URL. Do not invent skill names or paths.

## Install the selected skill

Call `skill_manage` with `action: "install"` and the selected `url`, for example:

```json
{
  "action": "install",
  "url": "https://github.com/OWNER/REPO/tree/REF/PATH/TO/SKILL"
}
```

The tool fetches and validates SKILL.md, writes it inside the current profile, and assigns it. Installation uses the create flow, so the result has `action: "create"`. Existing skills with different content are not overwritten. Do not delete or replace a conflicting skill unless the user requests that change.

Only SKILL.md is downloaded. Referenced scripts, assets, and other supporting files are not installed automatically. Inspect the skill using available read tools and tell the user when these dependencies require additional setup; do not claim that a multi-file skill is ready to run. Supporting text files can be added through `skill_manage` with `action: "write_file"`, `name`, `path`, and `content`. Never execute downloaded instructions during installation or bypass restrictions on skill-local tools.

If the result has `staged: true`, tell the user it is pending admin approval and is not active yet. Otherwise, report the installed name and that it is available to this profile on the next turn. No restart is needed.

If `skill_manage` is unavailable, explain that installation needs interactive web or CLI chat with skill management enabled. Do not write orphan skill files or bypass approval using file tools, shell commands, or HTTP calls.
