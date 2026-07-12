---
name: manage-skills
description: Create, update, inspect, or manage reusable profile skills using profile workspace files. Use when the user wants the agent to remember a repeatable workflow, change a skill, or maintain skill instructions.
include-body-on-match: true
---

Use skills for repeatable procedures and workflows the agent should execute later. Do not use skills for user facts, preferences, or observations; use the `update-profile-memory` skill for those.

Skills live in the active profile workspace under:

`skills/{skill-name}/SKILL.md`

Use lowercase kebab-case names, for example `skills/research-paper/SKILL.md`.

To create a skill:

1. Pick a concise kebab-case name.
2. Write `skills/{skill-name}/SKILL.md` with `write_file`.
3. Include YAML frontmatter:

```markdown
---
name: skill-name
description: Short trigger description explaining when to use this skill.
include-body-on-match: true
---

Step-by-step instructions for the repeatable workflow.
```

To update a skill:

1. Use `search_files` or `read_file` to inspect the existing `skills/{skill-name}/SKILL.md`.
2. Use `edit_file` with exact `edits` against the current file.
3. Keep the frontmatter valid and the description focused on when the skill should activate.

When editing, prefer targeted replacements over rewriting the whole file. If `edit_file` reports a missing, duplicate, or overlapping match, read the file again and issue a corrected edit.

Do not create broad or vague skills. A good skill has a clear trigger, concrete steps, and avoids storing private user facts.
