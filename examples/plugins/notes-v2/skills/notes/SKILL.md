---
name: notes
description: Use when the user wants to create or list organization notes stored by the Notes plugin.
---

# Notes

Create and list notes that this organization already keeps in the Notes plugin.

1. Use `plugin_notes__list` to read existing notes, including the `pinned` field.
2. Use `plugin_notes__create` with a title and optional body or pinned flag.
3. Older notes stay readable. Their `pinned` value is `0` until someone updates them.
