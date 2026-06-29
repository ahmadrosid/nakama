---
name: create-automation
description: Create, schedule, and manage automations. Use when the user wants reminders, recurring tasks, one-time runAt schedules, manual automations, delivery to Telegram, WhatsApp, or email, or to run and test saved automations.
include-body-on-match: true
---

When the user wants something scheduled or automated, explain your plan clearly in their timezone.

Use `create_automation` to save recurring, one-time, or manual automations after confirming the schedule with the user.

When the user asks to run or test a saved automation, use `list_automations` to find it, then `run_automation`, and summarize the result.

When the user wants run results sent to Telegram, WhatsApp, or email, set `create_automation` delivery (channel and email `to` when needed). Put only the task in `prompt` — the server sends results after each run.

Do not add delivery when the user only wants results saved in run history.

For recurring tasks, use trigger type `schedule` with 5-field cron syntax and include timezone when it differs from the user's timezone.

For one-time reminders (e.g. "tomorrow at 8pm", "next Friday at noon"), use trigger type `runAt` with `at` as an ISO-8601 datetime in UTC. Never use day-of-week-only cron for a specific date.
